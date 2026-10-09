import { fetchEventSource } from "@microsoft/fetch-event-source";
import {
	QueryClient,
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	active,
	attention,
	capacityPhaseLabel,
	finished,
	settleReason,
	workingLabel,
} from "../RunAttention.js";
import {
	accessGeneration,
	accessRequired,
	accessSignal,
	accessState,
	onAccessLost,
} from "./auth-state";
import { useFormState } from "./form-state";
import {
	authoritativeReady,
	beginWrite,
	checkVersion,
	disconnected,
	pwaState,
	uiBuild,
	usePwa,
	versionMismatch,
} from "./pwa";

export {
	active,
	attention,
	capacityPhaseLabel,
	finished,
	settleReason,
	workingLabel,
};
export const client = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (count) => accessState().status === "authenticated" && count < 2,
			refetchOnWindowFocus: true,
			staleTime: 1000,
		},
	},
});
onAccessLost(() => {
	void client.cancelQueries();
	client.clear();
});
export function useLiveUpdates() {
	const cache = useQueryClient();
	const [error, setError] = useState<string>();
	useEffect(() => {
		const controller = new AbortController();
		void fetchEventSource("/api/events", {
			signal: controller.signal,
			async onopen(response) {
				await validateLiveConnection(response);
				setError(undefined);
				// A new connection can have missed events while offline or in the background.
				void cache.invalidateQueries({ queryKey: ["runs"] });
				void cache.invalidateQueries({ queryKey: ["config"] });
				void cache.invalidateQueries({ queryKey: ["run"] });
				void cache.invalidateQueries({ queryKey: ["transcript"] });
			},
			onmessage(event) {
				if (event.event !== "change") return;
				const change = JSON.parse(event.data);
				void cache.invalidateQueries({ queryKey: ["runs"] });
				if (change.config)
					void cache.invalidateQueries({ queryKey: ["config"] });
				for (const id of change.ids ?? []) {
					void cache.invalidateQueries({ queryKey: ["run", id] });
					void cache.invalidateQueries({ queryKey: ["transcript", id] });
				}
			},
			onclose() {
				throw new Error("Live connection closed");
			},
			onerror(cause) {
				if (
					accessState().status !== "authenticated" ||
					pwaState().status === "mismatch"
				)
					throw cause; // Await an explicit update; do not accumulate rejected SSE streams.
				disconnected();
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Live connection unavailable",
					);
				return 2000;
			},
		}).catch(() => {
			/* Aborted during unmount; library reconnects other failures. */
		});
		return () => {
			controller.abort();
		};
	}, [cache]);
	return error;
}
export async function validateLiveConnection(response: Response) {
	try {
		if (response.status === 401) {
			accessRequired("Your session expired. Sign in again.");
			throw new Error("Sign in required");
		}
		if (
			!response.ok ||
			!response.headers.get("content-type")?.includes("text/event-stream")
		)
			throw new Error("Live connection unavailable");
		await refreshFactory();
	} catch (error) {
		// onopen runs before the SSE reader is created. Release its response on rejection.
		await response.body?.cancel();
		throw error;
	}
}
export async function api<T = any>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const epoch = accessGeneration();
	const authSignal = accessSignal();
	if (accessState().status !== "authenticated")
		throw new Error("Sign in required");
	const write = !["GET", "HEAD"].includes(
		(options.method ?? "GET").toUpperCase(),
	);
	const finish = write ? beginWrite() : undefined;
	// Bind the write to the configuration shown when it began, before async checks.
	const configRevision =
		write &&
		[
			"/api/workflows",
			"/api/title-settings",
			"/api/execution-profiles",
			"/api/runs",
		].includes(path)
			? client.getQueryData<any>(["config"])?.configRevision
			: undefined;
	try {
		if ((write || pwaState().status !== "ready") && !(await checkVersion()))
			throw new Error(
				"Factory connection or version unavailable. Reconnect or update before continuing.",
			);
		const response = await fetch(path, {
			...options,
			signal: options.signal
				? AbortSignal.any([options.signal, authSignal])
				: authSignal,
			cache: "no-store",
			headers: {
				"Content-Type": "application/json",
				"X-Factory-Request": "1",
				...(configRevision ? { "X-Factory-Config": configRevision } : {}),
				...options.headers,
				"X-Factory-Build": uiBuild,
			},
		});
		if (response.status === 401) {
			accessRequired("Your session expired. Sign in again.");
			throw new Error("Sign in required");
		}
		if (epoch !== accessGeneration()) throw new Error("Session changed");
		const responseBuild = response.headers.get("X-Factory-Build");
		if (!responseBuild) {
			const message =
				response.status === 403
					? "Factory request was blocked (HTTP 403). Check the public connection and reconnect."
					: "Factory response could not be verified. Check the public connection and reconnect.";
			disconnected(message);
			await response.body?.cancel();
			throw new Error(message);
		}
		if (responseBuild !== uiBuild) {
			versionMismatch(responseBuild);
			throw new Error("Factory version changed. Update before continuing.");
		}
		const body = await response.json();
		if (epoch !== accessGeneration()) throw new Error("Session changed");
		if (!response.ok) {
			if (response.status >= 500) disconnected();
			throw new Error(body.error ?? `Request failed (${response.status})`);
		}
		return body;
	} catch (error) {
		if (error instanceof TypeError) disconnected();
		throw error;
	} finally {
		finish?.();
	}
}
let refreshing: Promise<void> | undefined;
export function refreshFactory() {
	if (accessState().status !== "authenticated") return Promise.resolve();
	refreshing ??= refreshFactoryData().finally(() => {
		refreshing = undefined;
	});
	return refreshing;
}
async function refreshFactoryData() {
	if (!(await checkVersion()))
		throw new Error("Factory connection or version unavailable");
	await client.cancelQueries({
		predicate: (query) =>
			["config", "runs", "run"].includes(String(query.queryKey[0])),
	});
	await Promise.all([
		client.fetchQuery({
			queryKey: ["config"],
			queryFn: () => api("/api/config"),
			staleTime: 0,
		}),
		client.fetchQuery({
			queryKey: ["runs"],
			queryFn: () => api("/api/runs"),
			staleTime: 0,
		}),
	]);
	// Restored routes must validate their current run/gate before any actions are enabled.
	const refreshedRoute = location.hash;
	const id = /^#\/runs\/([^/]+)(?:\/review)?$/.exec(refreshedRoute)?.[1];
	if (id)
		await client
			.fetchQuery({
				queryKey: ["run", decodeURIComponent(id)],
				queryFn: () => api(`/api/runs/${id}?view=dashboard`),
				staleTime: 0,
			})
			.catch((error) => {
				if (error.message !== "Run not found") throw error;
				client.setQueryData(["run", decodeURIComponent(id)], null);
			});
	await client.invalidateQueries(
		{
			predicate: (query) =>
				["run", "transcript"].includes(String(query.queryKey[0])),
		},
		{ throwOnError: true },
	);
	if (location.hash !== refreshedRoute) return refreshFactoryData();
	authoritativeReady();
}
export function useConfig() {
	return useQuery({
		queryKey: ["config"],
		queryFn: ({ signal }) => api("/api/config", { signal }),
	});
}
export function useRuns() {
	return useQuery({
		queryKey: ["runs"],
		queryFn: ({ signal }) => api<any[]>("/api/runs", { signal }),
	});
}
export function useRun(id?: string) {
	return useQuery({
		queryKey: ["run", id],
		enabled: Boolean(id),
		queryFn: ({ signal }) =>
			api(`/api/runs/${encodeURIComponent(id!)}?view=dashboard`, { signal }),
	});
}
const pendingActions = new Set<string>();
export function useAction(scope?: string, context?: string) {
	const cache = useQueryClient();
	const connection = usePwa();
	const [formContext] = useFormState(context ?? "", () => ({}));
	const pendingCount = useIsMutating({ mutationKey: ["action", scope] });
	const mutation = useMutation({
		mutationKey: ["action", scope],
		mutationFn: ({
			path,
			body = {},
			method = "POST",
		}: {
			path: string;
			body?: any;
			method?: string;
			formContext?: object;
		}) => api(path, { method, body: JSON.stringify(body) }),
		onSuccess: async (data, { path, method = "POST" }) => {
			if (
				["/api/workflows", "/api/title-settings", "/api/capacity"].includes(
					path,
				) &&
				method === "PUT"
			) {
				// A failed refresh must not let the next edit restore old permissions.
				await cache.cancelQueries({ queryKey: ["config"] });
				cache.setQueryData(["config"], (previous: any) => ({
					...previous,
					...data,
				}));
			}
			void cache.invalidateQueries({ queryKey: ["runs"] });
			void cache.invalidateQueries({ queryKey: ["run"] });
			// Keep edits pending while refreshing any other configuration changes.
			await cache.invalidateQueries({ queryKey: ["config"] });
		},
	});
	return {
		...mutation,
		error:
			mutation.variables?.formContext === formContext ? mutation.error : null,
		isPending: mutation.isPending || (scope !== undefined && pendingCount > 0),
		mutateAsync: async (...args: Parameters<typeof mutation.mutateAsync>) => {
			if (scope && pendingActions.has(scope))
				throw new Error("This request is already pending.");
			if (scope) pendingActions.add(scope);
			try {
				const [request, options] = args;
				return await mutation.mutateAsync({ ...request, formContext }, options);
			} finally {
				if (scope) pendingActions.delete(scope);
			}
		},
		isBlocked: connection.status !== "ready" || connection.updating,
	};
}
export function ago(at?: string) {
	if (!at) return "just now";
	const minutes = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(at)) / 60000),
	);
	return minutes < 1
		? "just now"
		: minutes < 60
			? `${minutes}m ago`
			: minutes < 1440
				? `${Math.floor(minutes / 60)}h ago`
				: `${Math.floor(minutes / 1440)}d ago`;
}
export function elapsed(at: string) {
	return ago(at).replace(" ago", "");
}
export const icons: Record<string, string> = {
	"existing-work": "🔎",
	"assess-existing": "🧭",
	clarify: "💬",
	decisions: "📌",
	plan: "🗺️",
	"plan-review": "🧐",
	implement: "🔨",
	"draft-pr": "🚀",
	"code-review": "👀",
	"review-gate": "🚦",
	"code-fix": "🔧",
	ci: "🧪",
	"ci-fix": "🧪",
	"visual-scope": "🎯",
	capture: "🧪",
	"visual-review": "👀",
	"visual-gate": "✅",
	"visual-fix": "🔧",
	guide: "📖",
	handoff: "🎁",
	"human-review": "🙋",
	"human-fix": "🔧",
	merge: "🎉",
	simple: "⚡",
};
export function phase(id: string) {
	if (/visual|capture/.test(id)) return "indigo";
	if (/ci|merge-readiness/.test(id)) return "blue";
	if (/guide|handoff|human|merge/.test(id)) return "violet";
	if (/review|code-fix/.test(id)) return "green";
	if (/plan/.test(id)) return "orange";
	if (/implement|draft|simple/.test(id)) return "yellow";
	return "red";
}
export function stepsOf(run: any, config: any): any[] {
	const walk = (steps: any[], prefix = "", seen: string[] = []): any[] =>
		steps.flatMap((step) => {
			const key = prefix + step.id;
			if (step.type === "workflow") {
				if (seen.includes(step.workflow)) return [];
				const target = (
					run.workflowDefinitions ??
					config?.workflows ??
					[]
				).find((item: any) => item.id === step.workflow);
				return walk(target?.steps ?? [], `${key}/`, [...seen, step.workflow]);
			}
			return [
				{ ...step, key },
				...(step.groups ?? []).flatMap((group: any[], i: number) =>
					walk(group, `${key}/${i}/`, seen),
				),
			];
		});
	return walk(workflowOf(run, config)?.steps ?? []);
}
export function workflowOf(run: any, config: any) {
	return typeof run.workflow === "object"
		? run.workflow
		: (config?.workflows?.find((item: any) => item.id === run.workflow) ?? {
				id: "simple",
				name: "Simple / Bob’s Factory",
			});
}
export const friendly: Record<string, string> = {
	ticket: "Ticket",
	source: "Source pull request",
	repository: "Repository",
	"existing-work": "Existing work",
	"assess-existing": "Assessment",
	clarify: "Clarification",
	decisions: "Decision record",
	plan: "Implementation plan",
	"plan-review": "Plan review",
	implement: "Implementation report",
	"draft-pr": "Draft PR",
	"code-review": "Code review",
	"review-gate": "Review gate",
	ci: "CI checks",
	"merge-readiness": "Merge readiness",
	"ci-fix": "CI fix report",
	"visual-scope": "QA stories and screenshots",
	capture: "QA and screenshots",
	"visual-review": "QA and screenshot review",
	"visual-gate": "QA gate",
	guide: "Review guide",
	handoff: "Hand-off",
	"human-review": "Human review",
	merge: "Merge",
};
export function artifactsOf(
	run: any,
): { name: string; value: any; title: string }[] {
	const seen = new Set<string>();
	return Object.entries(run.outputs ?? {})
		.filter(([, v]) => {
			const hash = JSON.stringify(v);
			if (seen.has(hash)) return false;
			seen.add(hash);
			return true;
		})
		.map(([name, value]) => ({
			name,
			value,
			title:
				(value as any)?.stamp?.reviewer ??
				(!(value as any)?.qaContract &&
				["capture", "visual-scope", "visual-review", "visual-gate"].includes(
					name,
				)
					? (
							{
								capture: "Screenshots",
								"visual-scope": "Visual scope",
								"visual-review": "Visual review",
								"visual-gate": "Visual gate",
							} as Record<string, string>
						)[name]!
					: (friendly[name] ?? name)),
		}));
}
export function screenshotUrl(run: any, index: number, artifact = "capture") {
	const value = run.outputs?.[artifact];
	const shot = value?.screenshots?.[index];
	const version =
		shot?.imageSha256 ??
		value?.__artifactHash ??
		shot?.path ??
		value?.revision ??
		"";
	return `/api/runs/${encodeURIComponent(run.id)}/screenshots/${index}?artifact=${encodeURIComponent(artifact)}&v=${encodeURIComponent(version)}`;
}
