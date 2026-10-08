import { ECDH } from "node:crypto";
import { lookup } from "node:dns";
import { Agent } from "node:https";
import { isIP } from "node:net";
import webPush from "web-push";
import { z } from "zod";

export function publicAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const [a = 0, b = 0] = address.split(".").map(Number);
		return (
			![0, 10, 127, 169, 192, 224, 240, 255].includes(a) &&
			!(a === 172 && b >= 16 && b <= 31) &&
			!(a === 100 && b >= 64 && b <= 127) &&
			!(a === 198 && [18, 19, 51].includes(b)) &&
			!(a === 203 && b === 0) &&
			a < 224
		);
	}
	// Only global unicast. Reject mapped IPv4, local, multicast and documentation ranges.
	return (
		isIP(address) === 6 &&
		/^[23]/.test(address) &&
		!address.toLowerCase().startsWith("2001:db8:")
	);
}
export function pushEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.hash &&
			!url.search &&
			!url.port &&
			url.pathname.length > 1 &&
			(url.hostname === "fcm.googleapis.com" ||
				url.hostname === "updates.push.services.mozilla.com" ||
				/^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname))
		);
	} catch {
		return false;
	}
}
const key = (length: number) =>
	z
		.string()
		.regex(/^[A-Za-z0-9_-]+$/)
		.refine(
			(v) =>
				Buffer.from(v, "base64url").length === length &&
				Buffer.from(v, "base64url").toString("base64url") === v,
			"Invalid subscription key",
		);
export const SubscriptionSchema = z.object({
	endpoint: z
		.string()
		.max(2048)
		.refine(pushEndpoint, "Unsupported browser push endpoint"),
	keys: z.object({
		p256dh: key(65).refine((v) => {
			try {
				return (
					ECDH.convertKey(
						Buffer.from(v, "base64url"),
						"prime256v1",
						undefined,
						undefined,
						"uncompressed",
					).length === 65
				);
			} catch {
				return false;
			}
		}, "Invalid public key"),
		auth: key(16),
	}),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Vapid = { subject: string; publicKey: string; privateKey: string };
export type PushSender = (
	subscription: Subscription,
	payload: string,
	vapid: Vapid,
	topic: string,
) => Promise<void>;
export const sendPush: PushSender = async (
	subscription,
	payload,
	vapid,
	topic,
) => {
	SubscriptionSchema.parse(subscription);
	const agent = new Agent({
		// Check the actual DNS result used by the connection, preventing rebinding to private/tailnet IPs.
		lookup: (hostname, options, callback) =>
			lookup(hostname, options, (error, address, family) => {
				const values = Array.isArray(address)
					? address.map((v) => v.address)
					: [address];
				if (!error && values.some((value) => !publicAddress(value)))
					return callback(new Error("Push destination is not public"), "", 4);
				callback(error, address, family);
			}),
	});
	const deadline = setTimeout(() => agent.destroy(), 5000);
	try {
		// web-push uses https.request; it rejects non-2xx responses and never follows redirects.
		await webPush.sendNotification(subscription, payload, {
			vapidDetails: vapid,
			TTL: 0,
			timeout: 5000,
			topic,
			agent,
		});
	} finally {
		clearTimeout(deadline);
		agent.destroy();
	}
};
