import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryConfig } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { confirmedGroupedMerge } from "../src/factory/GroupedTools.js";
import { dependencyHashes, roleProgress } from "../src/factory/Incremental.js";
import {
	deliveryRevisions,
	repositoryRun,
	repositoryScopes,
} from "../src/factory/RepositoryScope.js";
import {
	finalizeGuideFiles,
	readReviewManifest,
	readReviewPatch,
} from "../src/factory/ReviewFiles.js";
import {
	type AggregateReview,
	assertAggregateRevision,
} from "../src/factory/SpecialistReview.js";
import { specialistSteps } from "../src/factory/specialistSteps.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { deliveryFixture } from "./fixtures/grouped-delivery.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "grouped-delivery-"));
	directories.push(directory);
	const forge = deliveryFixture(directory);
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: forge.command,
	});
	const workflow = WorkflowSchema.parse({
		id: "group",
		name: "Group",
		allowedTriggers: ["manual"],
		steps: ["draft-pr", "ci", "handoff", "human-review", "merge"].map(
			(tool) => ({ id: tool, name: tool, type: "tool", tool }),
		),
	});
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const run = runtime.create({
		id: "group",
		title: "Group delivery",
		repositoryId: "app",
		repositories: forge.repositories,
		workspace: directory,
		workflow,
		input: "Update app and api",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.outputs.guide = {
		goal: "Group",
		summary: "Update both",
		decision: { status: "ready", summary: "Reviewed" },
		behavior: [],
		requirements: [],
		checks: [],
		risks: [],
		reviewInstructions: [],
	};
	const context = (tool: string): ExecutionContext => ({
		run,
		step: workflow.steps.find((step) => step.id === tool)!,
		input: {},
		signal: new AbortController().signal,
		evidenceDir: directory,
		log: () => {},
		save: () => runtime.save(run),
	});
	const execute = async (tool: string) =>
		(run.outputs[tool] = await tools.tool(context(tool)));
	const approve = () => {
		run.humanDecisions = [
			{
				reviewId: "review",
				headSha: String(
					(run.outputs["draft-pr"] as Record<string, unknown>).headSha,
				),
				decision: "approve",
				at: new Date().toISOString(),
				repositories: deliveryRevisions(run.outputs["draft-pr"]),
			},
		];
	};
	return { directory, forge, tools, runtime, run, context, execute, approve };
}

it.each([
	"unchanged",
	"dirty",
	"commit",
])("specialist fanout binds every repository and rejects secondary changes: %s", async (change) => {
	const { directory, forge, execute } = fixture();
	await execute("draft-pr");
	const workflow = WorkflowSchema.parse({
		id: "specialist-group",
		name: "Grouped specialist review",
		allowedTriggers: ["manual"],
		steps: [
			...specialistSteps,
			{
				id: "review-gate",
				name: "Aggregate review",
				type: "tool",
				tool: "review-gate",
				review: {
					inventory: "extract-requirements",
					fanout: "specialist-review",
				},
			},
		],
	});
	const runtime = new WorkflowRuntime(directory, {
		agent: async (context) => {
			if (context.step.reviewContract === "inventory-v1")
				return {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion: "Update app and api",
							classification: "active",
							sources: [
								{ source: "originalInput", reference: "/originalInput" },
							],
						},
					],
					decisions: [],
					conflicts: [],
					questions: [],
					sourceReceipt: {
						considered: [
							{ source: "originalInput", reference: "/originalInput" },
						],
						unavailable: [],
					},
				};
			expect(
				context.reviewBaseline?.repositories?.map((r) => r.repositoryId),
			).toEqual(["app", "api", "context"]);
			if (context.step.id === "security-review" && change !== "unchanged") {
				const api = forge.repositories[1]!;
				writeFileSync(
					join(api.workspace, "shared.txt"),
					"Changed during review\n",
				);
				if (change === "commit") {
					forge.git(api, "add", ".");
					forge.git(api, "commit", "-qm", "unexpected reviewer change");
				}
			}
			return {
				summary: "Reviewed complete scope",
				findings: [],
				disagreements: [],
				...(context.step.reviewContract === "coverage-v1"
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									evidence: ["app and api commits"],
									reason: "Both requested repos changed",
								},
							],
						}
					: {}),
			};
		},
		script: async () => ({}),
		tool: async () => {
			throw new Error("Review aggregation belongs to the runtime");
		},
	});
	const run = runtime.create({
		id: "specialist-group",
		repositoryId: "app",
		repositories: forge.repositories,
		workspace: directory,
		workflow,
		input: "Update app and api",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	await runtime.launch(run);
	if (change === "unchanged") {
		expect(run.status).toBe("completed");
		const api = forge.repositories[1]!;
		const projected = repositoryRun(run, api);
		const aggregate = projected.outputs["review-gate"] as AggregateReview;
		expect(aggregate.reviewers).toHaveLength(6);
		expect(() =>
			assertAggregateRevision(
				aggregate,
				forge.git(api, "rev-parse", "HEAD"),
				forge.git(api, "rev-parse", "origin/development"),
			),
		).not.toThrow();
	} else {
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(
			/clean worktree|changed.*review|review.*invalidated/i,
		);
		expect(run.outputs["review-gate"]).toBeUndefined();
	}
	await runtime.shutdown();
});

it("recovers completion after cleanup only when every approved repository has confirmed merge", async () => {
	const { forge, run, execute, approve, context } = fixture();
	await execute("draft-pr");
	approve();
	run.workspace = "/missing-worktree";
	forge.requests.get("app")!.state = "MERGED";
	await expect(
		confirmedGroupedMerge(context("merge"), forge.command),
	).rejects.toThrow("api has not confirmed merge");
	forge.requests.get("api")!.state = "MERGED";
	forge.commands.length = 0;
	await expect(
		confirmedGroupedMerge(context("merge"), forge.command),
	).resolves.toMatchObject({ merged: true });
	expect(
		forge.commands.every(
			(command) => command.executable === "gh" && command.args[1] === "view",
		),
	).toBe(true);
	run.humanDecisions![0]!.repositories!.pop();
	await expect(
		confirmedGroupedMerge(context("merge"), forge.command),
	).rejects.toThrow("every published repository");
});

it("groups equal nonempty labels within a workspace, while unlabelled and unrelated repositories stay separate", () => {
	const configs: RepositoryConfig[] = [
		"niotix",
		"nx-dev",
		"factory",
		"unlabelled",
		"other-workspace",
	].map((name) => ({
		id: name,
		name,
		repositoryPath: `/repo/${name}`,
		baseBranch: "main",
		workspaceBaseDir: "/work",
		isActive: true,
		linearWorkspaceId: name === "other-workspace" ? "other" : "linear",
		routingLabels:
			name === "unlabelled"
				? []
				: name === "factory"
					? ["factory"]
					: name === "nx-dev"
						? ["nx-dev", "niotix"]
						: ["niotix", "nx-dev"],
	}));
	expect(
		repositoryScopes(configs).map((scope) => [scope.name, scope.repositoryIds]),
	).toEqual([
		["niotix", ["niotix", "nx-dev"]],
		["factory", ["factory"]],
		["unlabelled", ["unlabelled"]],
		["other-workspace", ["other-workspace"]],
	]);
});

it("publishes only changed repositories to their own base branches and persists partial publication for retry", async () => {
	const { forge, runtime, run, execute } = fixture();
	// Context-only Git repositories need no publication provider.
	delete run.repositories![2]!.githubUrl;
	forge.failPublication("api");
	await expect(execute("draft-pr")).rejects.toThrow(
		"api: Injected publication outage",
	);
	expect(
		runtime.get(run.id).repositoryOutputs?.app?.["draft-pr"],
	).toMatchObject({ url: "https://github.com/fixture/app/pull/1" });
	forge.failPublication();
	const output = await execute("draft-pr");
	expect(deliveryRevisions(output).map((delivery) => delivery.name)).toEqual([
		"app",
		"api",
	]);
	expect(forge.publications).toEqual(["app", "api"]);
	expect(
		forge.commands
			.filter((command) => command.args[1] === "create")
			.map((command) => [
				command.repositoryId,
				command.args[command.args.indexOf("--base") + 1],
			]),
	).toEqual([
		["app", "main"],
		["api", "development"],
		["api", "development"],
	]);
});

it("publishes a repository first changed by a fixer and refreshes all delivery revisions before approval", async () => {
	const { forge, run, execute, context } = fixture();
	await execute("draft-pr");
	const review = context("ci");
	review.step = { ...review.step, id: "code-review" };
	run.roleRevisions = {
		"code-review": (await roleProgress(review)).currentRevision!,
	};
	const app = forge.repositories[0]!;
	writeFileSync(join(app.workspace, "shared.txt"), "Fixed app\n");
	forge.git(app, "add", ".");
	forge.git(app, "commit", "-qm", "fix: correction");
	forge.git(app, "push", "origin", "HEAD");
	forge.requests.get("app")!.headSha = forge.git(app, "rev-parse", "HEAD");
	writeFileSync(
		join(forge.repositories[2]!.workspace, "shared.txt"),
		"New context implementation\n",
	);
	context("ci").step.branches.push({
		when: { path: "fix", equals: true },
		next: "ci-fix",
	});
	await expect(execute("ci")).resolves.toMatchObject({
		fix: true,
		reviewReady: false,
	});
	expect(forge.publications).toEqual(["app", "api", "context"]);
	expect(
		deliveryRevisions(run.outputs["draft-pr"]).map((item) => [
			item.repositoryId,
			item.headSha,
		]),
	).toEqual(
		forge.repositories.map((repository) => [
			repository.id,
			forge.requests.get(repository.id)!.headSha,
		]),
	);
	run.roleRevisions["code-review"] = (await roleProgress(review))
		.currentRevision!;
	await expect(execute("ci")).resolves.toMatchObject({
		fix: false,
		reviewReady: true,
	});
});

it.each([
	"api",
	"context",
])("blocks every merge before mutations when %s changes after approval", async (name) => {
	const { forge, execute, approve } = fixture();
	await execute("draft-pr");
	approve();
	writeFileSync(
		join(
			forge.repositories.find((repo) => repo.id === name)!.workspace,
			"shared.txt",
		),
		"Unreviewed change\n",
	);
	await expect(execute("merge")).resolves.toMatchObject({
		fix: true,
		merged: false,
	});
	expect(forge.merges).toEqual([]);
	expect(forge.requests.get("app")!.isDraft).toBe(true);
});

it("binds human approval to every delivery and resumes a partial merge without repeating the first merge", async () => {
	const { forge, execute, approve, run } = fixture();
	await execute("draft-pr");
	await execute("ci");
	await execute("handoff");
	const human = await execute("human-review");
	expect(deliveryRevisions(human)).toEqual(
		deliveryRevisions(run.outputs["draft-pr"]),
	);
	approve();
	forge.failMerge("api");
	await expect(execute("merge")).rejects.toThrow("api");
	expect(forge.merges).toEqual(["app"]);
	expect(run.repositoryOutputs?.app?.merge).toMatchObject({ merged: true });
	forge.failMerge();
	await expect(execute("merge")).resolves.toMatchObject({ merged: true });
	expect(forge.merges).toEqual(["app", "api"]);
});

it("retains all repository revisions and builds immutable review files without colliding identical filenames", async () => {
	const { directory, forge, execute, context, run } = fixture();
	await execute("draft-pr");
	await execute("ci");
	const ctx = context("handoff");
	ctx.step = { ...ctx.step, id: "guide" };
	ctx.progress = await roleProgress(ctx);
	expect(ctx.progress.currentRevision?.repositories).toHaveLength(3);
	expect(ctx.progress.reviewScope?.files).toEqual([
		"app/shared.txt",
		"api/shared.txt",
	]);
	const guide = (await finalizeGuideFiles(ctx, run.outputs.guide)) as {
		reviewFiles: Parameters<typeof readReviewManifest>[2];
	};
	const manifest = await readReviewManifest(
		directory,
		run.id,
		guide.reviewFiles,
	);
	expect(new Set(manifest.files.map((file) => file.id)).size).toBe(2);
	for (const file of manifest.files)
		expect(
			(await readReviewPatch(directory, manifest, file.id)).patch,
		).toContain("changed");
	expect(
		Object.keys(
			dependencyHashes(directory, ["app/**", "api/**"], forge.repositories),
		),
	).toContain("app/shared.txt");
	run.roleRevisions = { guide: ctx.progress.currentRevision! };
	expect((await roleProgress(ctx)).unchangedCode).toBe(true);
	writeFileSync(
		join(forge.repositories[2]!.workspace, "shared.txt"),
		"Context changed\n",
	);
	expect((await roleProgress(ctx)).unchangedCode).toBe(false);
});
