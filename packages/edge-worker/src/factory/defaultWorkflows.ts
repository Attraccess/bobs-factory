import { takeoverLaunchFields } from "./LaunchFields.js";
import { validateWorkflows } from "./Workflow.js";

const agent = (id: string, name: string, prompt: string, extra = {}) => ({
	id,
	name,
	type: "agent",
	prompt,
	...extra,
});
const tool = (id: string, name: string, tool: string, extra = {}) => ({
	id,
	name,
	type: "tool",
	tool,
	maxVisits: 100,
	...extra,
});
const back = (path: string, next: string) => [
	{ when: { path, equals: false }, next },
];

const review = `Review the current diff against the accepted plan. You receive ALL historical review rounds and fixer responses. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.`;
const fix = `Fix all open rating 2/3 findings. You receive ALL past findings and fixer dispositions; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"..."}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.`;

const ciAssessmentInstructions = ` Set reviewRequired=false ONLY when every newly assessed comment is informational or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.`;

const definitions = [
	{
		id: "simple",
		allowedTriggers: ["manual", "ticket-assignment"],
		icon: "⚡",
		name: "Simple / Cyrus",
		description:
			"The existing Cyrus run, with its original prompts, skills and runner lifecycle.",
		labels: ["workflow:simple"],
		chat: true,
		steps: [],
	},
	{
		id: "factory",
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		icon: "🏭",
		name: "Software factory",
		description:
			"Clarify → plan → implement → draft PR → review → CI → visual review → human guide.",
		labels: ["workflow:factory", "factory"],
		steps: [
			agent(
				"clarify",
				"Clarify requirements",
				`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. Empty questions means everything is understood. Preserve all answered decisions across rounds.`,
				{ askQuestions: true },
			),
			tool("decisions", "Record decisions", "record-decisions"),
			agent(
				"plan",
				"Write implementation plan",
				`Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. When taking over, include the existing-work and assess-existing results and PR review discussion; preserve completed work and plan only the remaining changes. Include the existing PR URL/branch and require continuing it. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. Do not implement.`,
			),
			agent(
				"plan-review",
				"Review implementation plan",
				`Review the plan against ALL input/comments/metadata and decisions. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["specific missing requirements or improvements"]}. Approve a practical MVP plan when complete.`,
				{ branches: back("approved", "plan") },
			),
			agent(
				"implement",
				"Implement accepted plan",
				`Implement the provided plan and use its assets. Read /answers alongside /plan for subsequent human responses, including resolution of implementation blockers. Follow repository conventions and appropriate verification. If implementation is forbidden, deferred, or blocked by missing access or a necessary decision, preserve completed work and return {"status":"blocked","summary":"concrete blocker","checks":["commands and outcomes"],"questions":["specific question or action needed to unblock implementation"]}. The workflow waits for an answer and resumes this role; do not report deferred or unfinished work as completed. Only after completing implementation return {"status":"completed","summary":"...","checks":["commands and outcomes"],"questions":[]}. Do not create or publish a PR; the next step handles delivery.`,
				{ inputs: ["plan"], askQuestions: true },
			),
			tool("draft-pr", "Push and create draft PR", "draft-pr"),
			agent("code-review", "Review code", review),
			tool("review-gate", "Discard nitpicks / review gate", "review-gate", {
				branches: back("approved", "code-fix"),
			}),
			tool("ci", "Watch merge readiness", "ci", {
				branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
			}),
			agent(
				"visual-scope",
				"Identify visual changes",
				`Inspect the exact PR diff and decide whether application visuals changed. Return {"changed":false,"areas":[]} for no visual changes, otherwise {"changed":true,"areas":[{"name":"region or element","url":"path/URL or application view","states":["mobile EN drawer with long names"],"instructions":"how to access and what changed"}]}. Enumerate every visually changed area, but select a SMALL REPRESENTATIVE evidence set: normally 1–2 concrete states per area and at most 24 screenshots total. Each state must be a single exact capture description, e.g. mobile EN drawer with long names; never list comma-separated alternatives or a Cartesian matrix of sizes × languages × permissions × errors. One screenshot can cover several elements; group co-visible regions. Add desktop+mobile only when both layouts materially differ; capture another language/theme only for distinct changed layout risk. Validate permissions, every error path and numeric edge cases with automated tests instead of extra screenshots unless their visual rendering changed. Prioritize changed happy path and the highest-risk visual edge case. Return captureBudget=24; an unusually broad feature may use up to 48 only with a concrete budgetReason explaining why representative evidence cannot fit. Include per-area rationale/dependencies. Do not change code or take screenshots.`,
				{ branches: back("changed", "guide") },
			),
			agent(
				"capture",
				"Capture changed areas",
				`Start the dev application as needed. Use available browser/screenshot tools to capture exactly the representative area/state inventory in visual-scope, within its captureBudget (normally 24). Do not expand combined state labels into combinations, invent extra states, or generate intermediate/debug images as review evidence. For a resumed legacy inventory without captureBudget, preserve its selected coverage and existing evidence; do not create an additional combinatorial matrix. The budget applies to the next compact visual-scope plan, not retroactively to an in-flight legacy capture. Do not classify deliberately redundant test combinations as missing critical visual evidence. One final image per selected area/state; replace bad attempts and keep only useful images in the returned inventory. Do not take routine tablet/language/role duplicates unless their layout changed. When subagent tools are available and multiple areas can be captured independently, use up to 3 subagents in parallel to speed up capture. Set up the application once, then give each subagent a disjoint area/state assignment, the exact revision, application URL/access instructions, required assets and evidence directory. Share the dev server; use separate browser pages/contexts where supported. If browser control is shared, serialize interactions to avoid interfering with each other's captures. Each subagent must capture and inspect its assigned areas, use unique filenames, report real image paths and any unavailable states, and leave shared server cleanup to you. If delegation or independent capture is unsupported, capture sequentially yourself. Wait for all subagents, inspect their results, and merge them into one complete inventory without duplicates or missing states. Save image files under the provided evidence directory, with a fresh filename for each revision. Inspect the captures for readability. Return {"screenshots":[{"path":"absolute path","caption":"area/state","area":"name","state":"exact state from the area inventory"}],"unavailable":[{"area":"name","reason":"concrete reason"}]}. Never claim captures that do not exist. Stop any dev server you started only after all captures finish. Do not change product code. Missing capture tooling must be reported in unavailable.`,
				{ next: "visual-review" },
			),
			agent(
				"visual-review",
				"Review screenshots",
				`${review}\nThis is a VISUAL review: open and inspect the actual screenshots, checking the agreed representative evidence plan and current changed visual risks. Do not demand all combinations of viewport, language, role or error states, or invent a larger screenshot matrix. Use actual test receipts for logic/permissions. Missing a critical selected visual state is a rating 3 finding; a redundant matrix combination or intentionally omitted nonvisual test case is not. Never approve genuinely missing critical evidence. Request the minimum targeted replacement needed for a finding, identifying exact area/state. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good screenshot, using its supplied exact hash. Exclude any screenshot affected by an unresolved finding. These receipts allow unchanged good evidence to survive a local visual fix. Preserve accepted evidence and do not demand a full recapture after a local correction.`,
				{ next: "visual-gate" },
			),
			tool("visual-gate", "Visual review gate", "visual-gate", {
				branches: back("approved", "visual-fix"),
				next: "guide",
			}),
			agent("code-fix", "Fix review findings", fix, { next: "code-review" }),
			agent(
				"ci-fix",
				"Fix CI failures",
				`Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using gh api graphql resolveReviewThread. Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-cyrus --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready.` +
					ciAssessmentInstructions,
				{ next: "after-ci-fix" },
			),
			tool(
				"after-ci-fix",
				"Check whether code needs another review",
				"review-after-fix",
				{
					branches: [
						{ when: { path: "reviewRequired", equals: false }, next: "ci" },
					],
					next: "code-review",
				},
			),
			agent("visual-fix", "Fix visual findings", fix, { next: "code-review" }),
			agent(
				"guide",
				"Prepare human review guide",
				`Write a complete, guided human review of the WHOLE PR at the current revision, including work that existed before takeover and every accepted iteration. This is a product walkthrough, not a recap of the last fix. First read /progress/reviewScope, the clarified requirements, decisions, accepted plan and cumulative capture inventory through factory-context. Inspect the actual base-to-head PR diff, grouping changes by feature/purpose rather than file or review iteration. The first guide always covers the entire feature. Put the core behavior first, consequences next, and supporting changes last.
Return {"goal":"user goal, at most 30 words","summary":"whole-PR outcome, at most 30 words","decision":{"status":"ready or needs-attention or blocked","summary":"at most 30 words"},"chapters":[{"id":"stable-feature-id","title":"short feature name","summary":"what changed and why, at most 40 words","before":"short original behavior","after":"short new behavior","requirementIndexes":[0],"files":["exact changed repository-relative file"],"screenshots":[{"area":"exact capture area","state":"exact capture state","caption":"what the human should notice"}],"diagrams":[{"title":"how this feature works","steps":[{"label":"short stage","detail":"one short sentence"}]}],"reviewChecks":["specific, short thing to verify"],"risks":["material limitation of this feature"],"evidence":["technical references/test receipts for expandable details"]}],"requirements":[{"criterion":"complete original acceptance criterion","status":"supported or gap or unverified or waived","evidence":["actual evidence"]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks, distinguish current-head CI from earlier local test receipts"],"risks":["material limitations and retained disagreements"],"reviewInstructions":["short final decision checks"]}.
Produce a small set of cohesive chapters (usually 4-10), one changed thing per chapter. Each requirement must be assigned to at least one chapter using zero-based requirementIndexes. Account for all changed files in chapter files, including tests/migrations/docs and inherited takeover work; supporting files may share a chapter. Use exact relative paths, no globs. Use real cumulative screenshots attached to their relevant chapter, not arbitrary first images or local Markdown image URLs. Keep the whole accepted inventory discoverable, but choose only the useful captures for each chapter. Explain nonvisual processing with a short flow diagram where it helps (e.g. input -> captured terms -> billing -> receipt); diagrams describe the product, not the factory pipeline. No decorative diagrams or invented evidence. Use everyday words; IDs, SHAs, long code descriptions and raw receipts belong in expandable evidence. Disclose fixture/hardware limitations and rejected scope complaints clearly.
On repeats, update affected chapters and retain unchanged feature chapters, requirements and evidence. A short revision summary may supplement a complete previous guide ONLY when a previous guide was actually human-reviewed and the actual change is a verified typo/documentation-only correction of at most 10 lines with no behavior, visual, dependency or configuration change. Never replace full feature coverage with the revision delta. Set revisionSummary=true and previousHeadSha only for that case, and put its short delta in revisionNote while summary still describes the entire feature. Require fresh explicit human approval of the current revision. Do not modify product code, recapture screenshots, rerun implementation or merge. Human-only merge blockers are remaining human actions, not unsupported implementation requirements.`,
				{ next: "handoff" },
			),
			tool("handoff", "Verify revision and hand off", "handoff", {
				next: "human-review",
			}),
			tool("human-review", "Human review", "human-review", {
				branches: [
					{ when: { path: "decision", equals: "reject" }, next: "human-fix" },
				],
				next: "merge",
			}),
			agent(
				"human-fix",
				"Address human feedback",
				`Address the latest human rejection/follow-up instructions in humanDecisions and human-review, preserving the accepted plan, decisions and all past review findings. Commit and push to the existing PR. Return {"summary":"what changed","checks":["commands and outcomes"]}. Do not merge, mark ready or assume approval.`,
				{ next: "code-review" },
			),
			tool("merge", "Merge approved revision", "merge", {
				branches: [
					{ when: { path: "rework", equals: true }, next: "code-review" },
					{ when: { path: "fix", equals: true }, next: "ci-fix" },
				],
				next: "end",
			}),
		],
	},
];

const pipeline = definitions[1]!;
export const defaultWorkflows = validateWorkflows([
	definitions[0],
	{
		...pipeline,
		steps: [
			{
				id: "pipeline",
				name: "Factory pipeline",
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		id: "takeover",
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		icon: "🤝",
		launchFields: takeoverLaunchFields,
		name: "Take over existing work",
		description:
			"Inspect an existing PR or ticket, clarify remaining work, then continue through the shared factory pipeline. Existing PRs stay draft for human review.",
		labels: ["workflow:takeover", "takeover"],
		steps: [
			tool(
				"existing-work",
				"Inspect existing work and discussion",
				"inspect-existing",
			),
			agent(
				"assess-existing",
				"Assess completed and remaining work",
				`Inspect the existing worktree, diff, ticket/PR discussion and review feedback. Do not discard or rewrite completed work. Return {"completed":["..."],"remaining":["..."],"risks":["..."],"assets":["..."]}. Identify unresolved feedback and questions to carry into clarification/planning. Do not implement or modify code.`,
			),
			{
				id: "pipeline",
				name: "Continue factory pipeline",
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		...pipeline,
		id: "factory-pipeline",
		name: "Shared factory pipeline",
		internal: true,
		allowedTriggers: ["workflow"],
		labels: [],
	},
]);

/** Upgrade the original flat Factory definition without losing customized roles. */
const legacyVisualPrompts: Record<string, string[]> = {
	guide: [
		'Write a Rocky-inspired review recap for the exact current PR revision, grounded in the supplied results/evidence. Return {"goal":"short user goal","summary":"short outcome","decision":{"status":"ready or needs-attention or blocked","summary":"..."},"requirements":[{"criterion":"...","status":"supported or gap or unverified","evidence":["..."]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks and CI results"],"risks":["actual limitations"],"reviewInstructions":["where to look and what to verify"]}. Include decisions, accepted/rejected review complaints, real screenshots where UI changed and remaining human actions. Never invent successful checks, screenshots or coverage. Use plain language. The PR stays draft for the human.',
		'Write a Rocky-inspired review recap for the exact current PR revision, grounded in the supplied results/evidence. Return {"goal":"short user goal","summary":"short outcome","decision":{"status":"ready or needs-attention or blocked","summary":"..."},"requirements":[{"criterion":"...","status":"supported or gap or unverified","evidence":["..."]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks and CI results"],"risks":["actual limitations"],"reviewInstructions":["where to look and what to verify"]}. Include decisions, accepted/rejected review complaints, real screenshots where UI changed and remaining human actions. Never invent successful checks, screenshots or coverage. Use plain language. The PR stays draft until explicit human approval. If this is a new review after a human request or merge-readiness correction, inspect the actual diff since the last human-reviewed SHA in humanDecisions. For a verified typo/documentation-only correction of at most 10 changed lines, with no behavior, visual, dependency or configuration changes, retain the previous guide requirements/evidence and provide a concise revision summary in summary with reviewInstructions describing exactly what changed. Set revisionSummary=true and include previousHeadSha. Still include the current revision checks and unresolved human actions, and require fresh explicit approval. For any uncertainty or other change, prepare the complete guide again. Human-only merge blockers (draft status or missing external reviewer approval) are remaining human actions, not unsupported implementation requirements; a complete implementation may be ready for the guide while these approvals wait.',
	],
	"visual-scope": [
		'Inspect the exact PR diff and decide whether application visuals changed. Return {"changed":false,"areas":[]} for no visual changes, otherwise {"changed":true,"areas":[{"name":"region or element","url":"path/URL or application view","states":["desktop, mobile, relevant interaction states"],"instructions":"how to access and what changed"}]}. Be precise and exhaustive. Do not change code or take screenshots.',
	],
	capture: [
		'Start the dev application as needed. Use available browser/screenshot tools to capture EVERY area and relevant state in visual-scope. When subagent tools are available and multiple areas can be captured independently, use up to 3 subagents in parallel to speed up capture. Set up the application once, then give each subagent a disjoint area/state assignment, the exact revision, application URL/access instructions, required assets and evidence directory. Share the dev server; use separate browser pages/contexts where supported. If browser control is shared, serialize interactions to avoid interfering with each other\'s captures. Each subagent must capture and inspect its assigned areas, use unique filenames, report real image paths and any unavailable states, and leave shared server cleanup to you. If delegation or independent capture is unsupported, capture sequentially yourself. Wait for all subagents, inspect their results, and merge them into one complete inventory without duplicates or missing states. Save image files under the provided evidence directory, with a fresh filename for each revision. Inspect the captures for readability. Return {"screenshots":[{"path":"absolute path","caption":"area/state","area":"name","state":"exact state from the area inventory"}],"unavailable":[{"area":"name","reason":"concrete reason"}]}. Never claim captures that do not exist. Stop any dev server you started only after all captures finish. Do not change product code. Missing capture tooling must be reported in unavailable.',
		'Start the dev application as needed. Use available browser/screenshot tools to capture EVERY area and relevant state in visual-scope. Save image files under the provided evidence directory, with a fresh filename for each revision. Inspect the captures for readability. Return {"screenshots":[{"path":"absolute path","caption":"area/state","area":"name","state":"exact state from the area inventory"}],"unavailable":[{"area":"name","reason":"concrete reason"}]}. Never claim captures that do not exist. Stop any dev server you started before finishing. Do not change product code. Missing capture tooling must be reported in unavailable.',
	],
	"visual-review": [
		'Review the current diff against the accepted plan. You receive ALL historical review rounds and fixer responses. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.\nThis is a VISUAL review: open and inspect the actual screenshots, checking each requested area/state against the plan. Include areas with missing/unavailable capture evidence as rating 3 findings. Never approve missing screenshots.',
	],
};

export function upgradeWorkflows(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	const definitions = structuredClone(value) as Record<string, unknown>[];
	const factory = definitions.find((item) => item.id === "factory");
	if (!definitions.some((item) => item.id === "factory-pipeline")) {
		const shared = structuredClone(
			defaultWorkflows.find((item) => item.id === "factory-pipeline")!,
		);
		if (
			factory &&
			Array.isArray(factory.steps) &&
			!factory.steps.some((step) => step.type === "workflow")
		) {
			shared.steps = factory.steps;
			factory.steps = structuredClone(
				defaultWorkflows.find((item) => item.id === "factory")!.steps,
			);
		}
		definitions.push({ ...shared });
	}
	if (!definitions.some((item) => item.id === "takeover"))
		definitions.push(
			structuredClone(defaultWorkflows.find((item) => item.id === "takeover")!),
		);
	for (const definition of definitions) {
		if (definition.id === "simple" && definition.chat === undefined)
			definition.chat = true;
		if (Array.isArray(definition.launchFields))
			definition.launchFields = definition.launchFields.filter(
				(field: { name?: string }) => field.name !== "title",
			);

		if (!Array.isArray(definition.steps)) continue;
		const steps = definition.steps as Record<string, unknown>[];
		if (!["factory-pipeline", "factory"].includes(String(definition.id)))
			continue;
		for (const step of steps) {
			const stock = defaultWorkflows
				.find((item) => item.id === "factory-pipeline")!
				.steps.find((item) => item.id === step.id);
			if (
				step.id === "clarify" &&
				step.prompt ===
					`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. Do not assume answers or implement anything. Return {"questions":["..."],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. Empty questions means everything is understood. Preserve all answered decisions across rounds.`
			)
				step.prompt = stock!.prompt;
			if (
				step.id === "implement" &&
				step.prompt ===
					`Implement the provided plan and use its assets. Follow repository conventions and appropriate verification. Return {"summary":"...","checks":["commands and outcomes"]}. Do not create or publish a PR; the next step handles delivery.`
			) {
				step.prompt = stock!.prompt;
				step.askQuestions = true;
			}
			if (
				step.type === "tool" &&
				step.maxVisits === 8 &&
				stock?.type === "tool" &&
				step.tool === stock.tool &&
				(step.name === stock.name ||
					(step.id === "ci" && step.name === "Watch pull request CI"))
			)
				step.maxVisits = stock.maxVisits;
			if (
				Object.hasOwn(legacyVisualPrompts, String(step.id)) &&
				legacyVisualPrompts[String(step.id)]!.includes(String(step.prompt))
			)
				step.prompt = defaultWorkflows
					.find((item) => item.id === "factory-pipeline")!
					.steps.find((item) => item.id === step.id)!.prompt;
		}
		const stockFix = steps.find(
			(step) =>
				step.id === "ci-fix" &&
				step.prompt ===
					`Diagnose and fix the CI failures in the supplied receipts and full past review history. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."]}. Do not merge or mark ready.`,
		);
		if (stockFix)
			stockFix.prompt = defaultWorkflows
				.find((item) => item.id === "factory-pipeline")!
				.steps.find((step) => step.id === "ci-fix")!.prompt;
		const ciFix = steps.find((step) => step.id === "ci-fix");
		const currentFixPrompt = defaultWorkflows
			.find((item) => item.id === "factory-pipeline")!
			.steps.find((step) => step.id === "ci-fix")!.prompt!;
		if (
			ciFix?.prompt === currentFixPrompt.replace(ciAssessmentInstructions, "")
		)
			ciFix.prompt = currentFixPrompt;
		if (
			ciFix?.next === "code-review" &&
			!steps.some((step) => step.id === "after-ci-fix") &&
			ciFix.prompt ===
				defaultWorkflows
					.find((item) => item.id === "factory-pipeline")!
					.steps.find((step) => step.id === "ci-fix")!.prompt
		) {
			ciFix.next = "after-ci-fix";
			steps.push(
				structuredClone(
					defaultWorkflows
						.find((item) => item.id === "factory-pipeline")!
						.steps.find((step) => step.id === "after-ci-fix")!,
				) as unknown as Record<string, unknown>,
			);
		}
		const ci = steps.find((step) => step.tool === "ci");
		if (ci && Array.isArray(ci.branches))
			ci.branches = ci.branches.map((branch) =>
				branch.next === "ci-fix" &&
				branch.when?.path === "approved" &&
				branch.when?.equals === false
					? { ...branch, when: { path: "fix", equals: true } }
					: branch,
			);
		const handoff = steps.find((step) => step.tool === "handoff");
		if (
			!handoff ||
			steps.some((step) => step.id === "human-review") ||
			(handoff.next && handoff.next !== "end")
		)
			continue;
		handoff.next = "human-review";
		const shared = defaultWorkflows.find(
			(item) => item.id === "factory-pipeline",
		)!;
		steps.push(
			...structuredClone(
				shared.steps.filter((step) =>
					["human-review", "human-fix", "merge"].includes(step.id),
				),
			).map((step) => ({ ...step })),
		);
	}
	return definitions;
}
