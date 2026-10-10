import type { IIssueTrackerService } from "bobs-factory-core";
import { z } from "zod";
import type {
	TicketDeliveryAdapter,
	TicketRelation,
	TicketTarget,
} from "./Delivery.js";
import { mcpValue } from "./TicketTracking.js";

const limitation =
	"Provider does not offer conditional content/relationship writes. State is checked before and after dispatch; concurrent writes can still race.";
export function taskbotDeliveryAdapter(
	resource: Extract<TicketTarget, { provider: "taskbot" }>,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
	capabilities: TicketDeliveryAdapter["capabilities"],
): TicketDeliveryAdapter {
	const args = { project: resource.project, id: Number(resource.id) };
	const invoke = async (tool: string, extra = {}) =>
		mcpValue(await call(tool, { ...args, ...extra }));
	return {
		capabilities,
		limitation,
		async read() {
			const linked = z.union([
				z.number().int().positive(),
				z.object({ id: z.number().int().positive() }).passthrough(),
			]);
			const raw = z
				.object({
					id: z.literal(Number(resource.id)),
					title: z.string(),
					body: z.string().nullable(),
					project: z.string().optional(),
					links: z.object({
						blocks: z.array(linked),
						blocked_by: z.array(linked),
						related: z.array(linked),
					}),
				})
				.passthrough()
				.parse(await invoke("get_ticket"));
			if (
				(raw.project !== undefined && raw.project !== resource.project) ||
				raw.nextOffset != null ||
				raw.next_cursor != null ||
				raw.has_more === true
			)
				throw new Error(
					"Wrong project or incomplete Taskbot ticket relationships",
				);
			const id = (v: z.infer<typeof linked>) =>
				String(typeof v === "number" ? v : v.id);
			const relationships: TicketRelation[] = [
				...raw.links.blocks.map((v) => ({
					type: "blocks" as const,
					from: resource.id,
					to: id(v),
				})),
				...raw.links.blocked_by.map((v) => ({
					type: "blocks" as const,
					from: id(v),
					to: resource.id,
				})),
				...raw.links.related.map((v) => ({
					type: "related" as const,
					from: resource.id,
					to: id(v),
				})),
			];
			return {
				resource,
				fields: { title: raw.title, description: raw.body },
				relationships,
				complete: true,
			};
		},
		async content(fields) {
			await invoke("update_ticket", {
				...(fields.title !== undefined ? { title: fields.title } : {}),
				...(fields.description !== undefined
					? { body: fields.description ?? "" }
					: {}),
			});
		},
		async relationship(kind, value) {
			if (![value.from, value.to].every((v) => /^[1-9]\d*$/.test(v)))
				throw new Error("Taskbot relation requires numeric resource IDs");
			await invoke(kind === "add" ? "link" : "unlink", {
				id: Number(value.from),
				to: Number(value.to),
				type: value.type,
			});
		},
	};
}
export function linearDeliveryAdapter(
	resource: Extract<TicketTarget, { provider: "linear" }>,
	tracker: IIssueTrackerService,
): TicketDeliveryAdapter {
	if (
		tracker.getPlatformType() !== "linear" ||
		!tracker.fetchDeliveryTicket ||
		!tracker.setDeliveryRelationship
	)
		throw new Error(
			"Configured native tracker lacks complete Linear ticket delivery capabilities",
		);
	return {
		capabilities: ["read", "content", "relationships"],
		limitation,
		async read() {
			const ticket = await tracker.fetchDeliveryTicket!(resource.id);
			if (
				ticket.id !== resource.id ||
				ticket.url !== resource.url ||
				ticket.project !== resource.project
			)
				throw new Error(
					"Linear ticket identity/project differs from accepted target",
				);
			return {
				resource,
				fields: { title: ticket.title, description: ticket.description },
				relationships: ticket.relationships,
				complete: true,
			};
		},
		async content(fields) {
			await tracker.updateIssue(resource.id, {
				...(fields.title !== undefined ? { title: fields.title } : {}),
				...(fields.description !== undefined
					? { description: fields.description ?? "" }
					: {}),
			});
		},
		async relationship(kind, value) {
			await tracker.setDeliveryRelationship!(kind, value);
		},
	};
}
