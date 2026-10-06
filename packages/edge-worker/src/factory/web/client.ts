import { fetchEventSource } from "@microsoft/fetch-event-source";
import {
	QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
export const client = new QueryClient({
	defaultOptions: {
		queries: { retry: 2, refetchOnWindowFocus: true, staleTime: 1000 },
	},
});
export function useLiveUpdates() {
	const cache = useQueryClient();
	const [error, setError] = useState<string>();
	useEffect(() => {
		const controller = new AbortController();
		void fetchEventSource("/api/events", {
			signal: controller.signal,
			async onopen(response) {
				if (
					!response.ok ||
					!response.headers.get("content-type")?.includes("text/event-stream")
				)
					throw new Error("Live connection unavailable");
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
export async function api<T = any>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const response = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			...options.headers,
		},
	});
	const body = await response.json();
	if (!response.ok)
		throw new Error(body.error ?? `Request failed (${response.status})`);
	return body;
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
export function useAction() {
	const cache = useQueryClient();
	return useMutation({
		mutationFn: ({
			path,
			body = {},
			method = "POST",
		}: {
			path: string;
			body?: any;
			method?: string;
		}) => api(path, { method, body: JSON.stringify(body) }),
		onSuccess: async (data, { path, method = "POST" }) => {
			if (
				["/api/workflows", "/api/title-settings"].includes(path) &&
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
}
export const finished = (status: string) =>
	[
		"completed",
		"complete",
		"failed",
		"error",
		"interrupted",
		"stopped",
		"cancelled",
	].includes(status);
export const active = (status: string) =>
	["running", "active", "waiting"].includes(status);
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
				name: "Simple / Cyrus",
			});
}
export function settleReason(
	run: any,
	runs: any[],
	now = Date.now(),
): string | undefined {
	if (!finished(run.status)) return undefined;
	const view = run.viewState ?? {};
	if (view.keptOpen) return undefined;
	if (view.settledAt) return "✓ Settled by you";
	if (
		view.seenAt &&
		["complete", "completed"].includes(run.status) &&
		!run.outputs?.guide &&
		!run.hasGuide
	)
		return "👀 Seen after it finished";
	if (["stopped", "cancelled"].includes(run.status)) return "■ Stopped";
	if (
		["failed", "error", "interrupted"].includes(run.status) &&
		runs.some(
			(other) =>
				other.triggerOrigin?.manual?.sourceRunId === run.id &&
				other.createdAt > run.createdAt,
		)
	)
		return "↻ Replaced by a newer run";
	if (now - Date.parse(run.updatedAt ?? run.createdAt) > 48 * 3600000)
		return "💤 Quiet for 48h+";
	return undefined;
}
export function attention(run: any) {
	if (run.reviewGate?.status === "pending" && run.status === "waiting")
		return "review";
	if (run.status === "waiting") return "question";
	if (["failed", "error", "interrupted"].includes(run.status)) return "stuck";
	if (["complete", "completed"].includes(run.status)) return "review";
	return undefined;
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
				!(value as any)?.qaContract &&
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
					: (friendly[name] ?? name),
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
