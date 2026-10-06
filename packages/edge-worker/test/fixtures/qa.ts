import { QaScopeSchema } from "../../src/factory/FactoryResults.js";
import { QaCaptureSchema } from "../../src/factory/FactoryTools.js";
export function qaScope(surface: "ui" | "api" | "cli" = "api") {
	return QaScopeSchema.parse({
		qaContract: "qa-v1",
		changed: surface === "ui",
		captureBudget: 24,
		areas:
			surface === "ui"
				? [
						{
							name: "Editor",
							url: "/",
							states: ["saved"],
							instructions: "Save the record",
							dependencies: ["view.ts"],
						},
					]
				: [],
		stories: [
			{
				id: "save",
				goal: "Save a record",
				requirementRefs: ["requirements/0"],
				interface: surface,
				preconditions: ["Application ready"],
				fixtures: ["Record fixture"],
				actions: ["Save a valid record"],
				criteria: [{ id: "saved", expected: "Record is persisted" }],
				evidenceInstructions: "Execute save and read it back",
				screenshotTasks:
					surface === "ui" ? [{ area: "Editor", state: "saved" }] : [],
			},
		],
		exclusions: [],
	});
}
export function qaExecution(
	outcome: "passed" | "failed" | "blocked" = "passed",
) {
	return QaCaptureSchema.parse({
		qaContract: "qa-v1",
		screenshots: [],
		unavailable: [],
		findings: [],
		observations: [],
		results: [
			{
				storyId: "save",
				outcome,
				criteria: [
					{
						criterionId: "saved",
						outcome,
						expected: "Record is persisted",
						observed:
							outcome === "passed" ? "Read back record 42" : "Record missing",
						...(outcome === "blocked"
							? { blockedReason: "Test account unavailable" }
							: {}),
						evidence:
							outcome === "blocked"
								? []
								: [
										{
											kind: "http",
											executed: true,
											action: "POST /records; GET /records/42",
											details: "201 created; 200 record 42",
										},
									],
					},
				],
			},
		],
	});
}
