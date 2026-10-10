import { expect, it } from "vitest";
import { CapacityStateSchema } from "../src/capacity-state.js";

const request = {
	id: "a",
	token: "a",
	identity: "a",
	owner: { pid: 1, start: "start", incarnation: "incarnation" },
	sequence: 1,
	queuedAt: "2026-10-09T00:00:00Z",
	phase: "queued",
	background: false,
	recoverable: true,
	remote: false,
};
const state = {
	version: 1,
	limit: 1,
	sequence: 3,
	bypass: 0,
	requests: [request],
};
it("reads legacy requests and retains workflow positions", () => {
	expect(
		CapacityStateSchema.parse(state).requests[0]?.admissionPosition,
	).toBeUndefined();
	const workflow = { identity: "run", createdAt: "2026-10-09T00:00:00Z" };
	expect(
		CapacityStateSchema.parse({
			...state,
			requests: [{ ...request, workflowRun: workflow, admissionPosition: 3 }],
		}).requests[0],
	).toMatchObject({ workflowRun: workflow, admissionPosition: 3 });
});
it.each([
	0, 4, -1, 1.5,
])("rejects invalid admission position %s", (admissionPosition) => {
	expect(
		CapacityStateSchema.safeParse({
			...state,
			requests: [{ ...request, admissionPosition }],
		}).success,
	).toBe(false);
});
it("rejects duplicate effective positions and conflicting ages", () => {
	const second = {
		...request,
		id: "b",
		token: "b",
		identity: "b",
		sequence: 2,
	};
	expect(
		CapacityStateSchema.safeParse({
			...state,
			requests: [request, { ...second, admissionPosition: 1 }],
		}).success,
	).toBe(false);
	expect(
		CapacityStateSchema.safeParse({
			...state,
			requests: [
				{
					...request,
					workflowRun: { identity: "run", createdAt: "2026-10-09T00:00:00Z" },
				},
				{
					...second,
					workflowRun: { identity: "run", createdAt: "2026-10-08T00:00:00Z" },
				},
			],
		}).success,
	).toBe(false);
});
