import { PrecacheController } from "workbox-precaching";
import { Route, Router } from "workbox-routing";

// Generated from the same inventory as the server snapshot. No runtime data cache.
const shell = __SHELL__;
const prefix = "bobs-factory-shell-";
const cacheName = prefix + shell.build;
const resources = new Map(
	shell.resources.map((resource) => [resource.path, resource]),
);
const clientBuilds = new Map();
const immutablePath = /^\/(app\.[a-f0-9]{24}\.js|styles\.[a-f0-9]{24}\.css)$/;
async function cleanup() {
	// The active worker must never prune a successfully precached waiting update.
	if (self.registration.waiting || self.registration.installing) return;
	const clients = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	// Unknown/unresponsive clients might still need an older shell. Retain it until they identify or close.
	if (clients.some((client) => !clientBuilds.has(client.id))) return;
	const keep = new Set([
		cacheName,
		...clients.map((client) => prefix + clientBuilds.get(client.id)),
	]);
	for (const name of await caches.keys())
		if (name.startsWith(prefix) && !keep.has(name)) await caches.delete(name);
}
// Workbox owns precache download/storage and routing; factory policy remains explicit.
// A cache per completed build keeps old tabs and a waiting update independent.
const precache = new PrecacheController({
	cacheName,
	fallbackToNetwork: false,
	plugins: [
		{
			requestWillFetch: async ({ request }) =>
				new Request(request, {
					cache: "no-store",
					redirect: "error",
				}),
			cacheWillUpdate: async ({ request, response }) => {
				const resource = resources.get(new URL(request.url).pathname);
				if (
					!resource ||
					!response.ok ||
					response.redirected ||
					response.headers.get("X-Factory-Build") !== shell.build ||
					!response.headers.get("Content-Type")?.startsWith(resource.type)
				)
					throw new Error("Incomplete factory shell");
				return response;
			},
		},
	],
});
precache.addToCacheList(
	shell.resources.map((resource) => ({
		url: resource.path,
		// The whole cache is build-versioned. SRI makes the browser reject wrong bytes.
		revision: null,
		integrity: resource.integrity,
	})),
);
self.addEventListener("install", (event) => {
	event.waitUntil(
		precache.install(event).catch(async (error) => {
			await caches.delete(cacheName);
			throw error;
		}),
	);
});
self.addEventListener("activate", (event) => {
	// No clients.claim on first installation. Only explicit activation opts into taking control.
	event.waitUntil(Promise.all([precache.activate(event), cleanup()]));
});
self.addEventListener("message", (event) => {
	if (
		!event.source ||
		new URL(event.source.url).origin !== self.location.origin
	)
		return;
	if (event.data?.type === "BUILD")
		event.ports[0]?.postMessage({ build: shell.build });
	if (event.data?.type === "HELLO" && /^[a-f0-9]{24}$/.test(event.data.build)) {
		clientBuilds.set(event.source.id, event.data.build);
		event.waitUntil(cleanup());
	}
	if (event.data?.type === "ACTIVATE" && event.data.build === shell.build) {
		event.waitUntil(self.skipWaiting());
		event.ports[0]?.postMessage({ build: shell.build });
	}
	if (event.data?.type === "CLAIM" && event.data.build === shell.build)
		event.waitUntil(self.clients.claim());
});
const router = new Router();
// HashRouter navigations live only at /. Never turn API/media/unknown 404s into HTML.
router.registerRoute(
	new Route(
		({ request, url, sameOrigin }) =>
			sameOrigin &&
			!url.search &&
			url.pathname === "/" &&
			request.mode === "navigate",
		async ({ request }) => {
			try {
				const response = await fetch(request);
				if (response.status >= 500)
					return (await precache.matchPrecache("/")) ?? response;
				if (
					!response.ok ||
					!/^[a-f0-9]{24}$/.test(
						response.headers.get("X-Factory-Build") ?? "",
					) ||
					response.headers.get("X-Factory-Build") === shell.build
				)
					return response;
				// Keep this worker's shell coherent until an explicit update.
				return (await precache.matchPrecache("/")) ?? response;
			} catch {
				return (await precache.matchPrecache("/")) ?? Response.error();
			}
		},
	),
);
router.registerRoute(
	new Route(
		({ url, sameOrigin }) =>
			sameOrigin &&
			!url.search &&
			(resources.has(url.pathname) || immutablePath.test(url.pathname)),
		async ({ request, url }) => {
			const current = await precache.matchPrecache(request);
			if (current) return current;
			// A tab that deferred the update can still request its immutable resources after activation.
			if (immutablePath.test(url.pathname))
				for (const name of await caches.keys()) {
					if (!name.startsWith(prefix)) continue;
					const cached = await (await caches.open(name)).match(request);
					if (cached) return cached;
				}
			// Never repair a cache from unvalidated runtime requests.
			return fetch(request);
		},
	),
);
router.addFetchListener();

const notificationBodies = {
	question: "New questions need your answer.",
	review: "A new review needs your approval.",
	failure: "A run needs your help.",
	blocker: "A run needs a decision.",
	completion: "A run completed successfully.",
	test: "Test notification. Open Factory to check current state.",
};
function notificationDestination(data) {
	if (data?.category === "test") return "/#/";
	if (
		typeof data?.runId !== "string" ||
		!/^[A-Za-z0-9_-]{1,200}$/.test(data.runId)
	)
		return "/#/";
	const path = `/#/runs/${encodeURIComponent(data.runId)}`;
	return data.destination === path || data.destination === `${path}/review`
		? data.destination
		: "/#/";
}
self.addEventListener("push", (event) => {
	let payload;
	try {
		payload = event.data?.json();
	} catch {
		/* Always display a safe visible fallback. */
	}
	const valid =
		payload?.version === 1 &&
		Object.hasOwn(notificationBodies, payload.category);
	const data = valid
		? {
				category: payload.category,
				runId: payload.runId,
				destination: notificationDestination(payload),
			}
		: { category: "test", destination: "/#/" };
	event.waitUntil(
		self.registration.showNotification("Bob’s Factory", {
			body: valid
				? notificationBodies[payload.category]
				: "Open Factory to check current state.",
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
			tag:
				typeof data.runId === "string" &&
				/^[A-Za-z0-9_-]{1,200}$/.test(data.runId)
					? `factory-${data.runId}`
					: "factory-test",
			data,
		}),
	);
});
self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const destination = notificationDestination(event.notification.data);
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			const window = windows.find((client) => {
				const url = new URL(client.url);
				return (
					url.origin === self.location.origin &&
					url.pathname === "/" &&
					!url.search
				);
			});
			if (window) {
				// The app changes only its hash after pausing actions; drafts survive in the same tab.
				window.postMessage({ type: "FACTORY_NOTIFICATION", destination });
				await window.focus();
			} else
				await self.clients.openWindow(
					new URL(destination, self.location.origin).href,
				);
		})(),
	);
});
