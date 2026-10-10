import { feedbackPolicyInstructions } from "./FeedbackPolicy.js";
import {
	BRIEF_CONTRACT,
	briefPrompt,
	briefVideoInstructions,
} from "./GuideAuthoring.js";
import { takeoverLaunchFields } from "./LaunchFields.js";
import { legacyGuidePrompt } from "./legacyGuidePrompt.js";
import { legacyScreenshotSteps } from "./legacyScreenshotSteps.js";
import { QA_CONTRACT } from "./Qa.js";
import { reviewFixInstructions } from "./ReviewRecovery.js";
import {
	inventoryGuideInstructions,
	inventoryQaInstructions,
	specialistSteps,
} from "./specialistSteps.js";
import { videoPrompts } from "./videoPrompts.js";
import { validateWorkflows, type WorkflowStep } from "./Workflow.js";

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

const review = `Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.`;
const fix = `Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\n${reviewFixInstructions}`;

const githubApiHelper = String.raw`sh -c "$BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND github-api \"\$@\"" bobs-factory --repo "$repoUrl" --request "$requestFile"`;

const ciAssessmentInstructions = ` Set reviewRequired=false ONLY when every newly assessed comment is informational, explicitly ignored by the user, or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.\n${feedbackPolicyInstructions}`;

const definitions = [
	{
		id: "simple",
		allowedTriggers: ["manual", "ticket-assignment"],
		icon: "⚡",
		name: "Simple / Bob’s Factory",
		description:
			"The existing Bob’s Factory run, with its original prompts, skills and runner lifecycle.",
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
			"Clarify and plan, then deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: ["workflow:factory", "factory"],
		steps: [
			agent(
				"clarify",
				"Clarify requirements",
				`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. Empty questions means everything is understood. Preserve all answered decisions across rounds.`,
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
				"Plan QA stories and screenshots",
				`Read the accepted requirements, all recorded decisions/expectations, plan, implementation receipts, relevant history and exact cumulative base-to-head PR diff (including inherited takeover work). Plan observable QA for ALL changed behavior: UI, API, CLI and other interfaces. Declare environment:{isolation:"worktree"} only when all QA uses independent per-worktree servers, databases and fixtures. For shared clusters, databases, fixtures or browser control return environment:{isolation:"shared",resources:["stable shared resource identity"]}; use the same identity across repositories/runs using that resource. Unknown isolation requires shared protection, never assume a worktree isolates external resources. Cover happy paths and consequential failure, permission and boundary cases proportionately. Trace stories to agreed requirements; do not invent business requirements or turn subjective preferences into blocking criteria. Explain any requirement/diff area outside executable QA in exclusions. Assess navigation, feedback, readability and recovery where relevant.
Return {"qaContract":"qa-v1","changed":false,"areas":[],"captureBudget":24,"stories":[{"id":"stable-story-id","goal":"user goal","requirementRefs":["requirements/0 or decisions/0 or answers/0 (existing zero-based accepted record)"],"interface":"ui or api or cli or other","preconditions":["setup"],"fixtures":["access or data needed"],"actions":["ordered executable action"],"criteria":[{"id":"globally unique stable criterion ID","expected":"observable expected outcome"}],"evidenceInstructions":"how to execute and record evidence","screenshotTasks":[{"area":"exact selected area","state":"exact selected state at a defined point in these actions"}]}],"exclusions":[{"requirementRef":"requirement/diff area","reason":"concrete reason outside executable QA"}]}.
changed refers only to VISUAL scope. Nonvisual changes still need executable stories with real behavioral checks and may have zero screenshots. No changed executable behavior may use stories=[] only with a concrete notApplicableReason; no visual changes is insufficient. Inspect relevant existing tests before selecting them as criterion evidence.
For visuals return changed=true and areas:[{name,url,states:["single concrete representative state"],instructions,rationale,dependencies,changed}]. Normally choose 1–2 states per area and at most 24 screenshots. Group co-visible elements. Never multiply viewport/language/role combinations or comma-separated alternatives. Additional states must show distinct changed rendering risk. Up to 48 needs a concrete budgetReason. Every selected area/state must be linked to a story; API/CLI checks do not need artificial images. Dependencies are exact repository files or directory/** paths. Do not change code, execute QA or take screenshots.`,
				{ qaContract: QA_CONTRACT },
			),
			agent(
				"capture",
				"Execute QA and capture screenshots",
				`Execute EVERY planned QA story and acceptance criterion from visual-scope, including nonvisual API/CLI behavior. Read /answers for resolved access, fixtures and tooling blockers. Set up the application once when needed, use appropriate actual fixtures, and execute browser/HTTP/CLI/tests as instructed. Inspect test coverage and run the checks; source inspection or an implementation receipt alone cannot establish a pass. Compare observed outcomes with each exact expected outcome. Assess applicable navigation, feedback, readability and recovery. Do not modify product code or repair failures.
Return {"qaContract":"qa-v1","results":[{"storyId":"planned ID","outcome":"passed or failed or blocked","criteria":[{"criterionId":"planned ID","outcome":"passed or failed or blocked","expected":"exact expected outcome from scope","observed":"actual observed outcome","blockedReason":"concrete assistance needed when blocked","evidence":[{"kind":"command or test or http or browser or log","executed":true,"action":"actual command/request/actions performed","details":"exit/result/request-response/log details demonstrating this criterion","exitCode":0,"screenshotTasks":[{"area":"selected area","state":"selected state"}]}]}]}],"findings":[{"id":"stable finding ID","rating":3,"summary":"consequential requirement failure","evidence":"concrete receipt","status":"open","storyId":"planned ID","criterionId":"planned criterion ID","requirementRefs":["accepted requirement"],"reproduction":["steps"],"expected":"expected behavior","actual":"actual behavior"}],"observations":[{"id":"stable observation ID","summary":"optional UI/UX improvement","evidence":"observed details","storyId":"story ID"}],"screenshots":[{"path":"absolute real image path","caption":"what it demonstrates","area":"exact area","state":"exact state"}],"unavailable":[{"area":"selected area","reason":"concrete missing access/tooling/setup or failed behavior","cause":"access or product"}]}.
One result per story and criterion. Ratings 2/3 are consequential failures against agreed requirements; keep optional preferences in observations. Product failures are failed with actionable findings. If failed product behavior prevents a selected screenshot, report unavailable with cause:"product" linked to that failing story; missing access/tooling uses cause:"access". Missing access, fixtures or tooling is blocked with a concrete reason; never pass an unexecuted check. Story outcome must agree with criterion outcomes. Do not supply a revision claim; runtime stamps provenance. Execute criteria freshly on each visit; image reuse never establishes a behavioral pass.
Capture exactly the selected representative screenshot tasks at their defined points DURING the story flows. Keep the captureBudget (normally 24, justified maximum 48), one real PNG/JPEG per exact area/state. Do not invent states or expand combinations. Save images under the supplied evidence directory with fresh filenames for each revision; inspect actual captures for readability. Keep the complete inventory, including provenance-eligible explicitly accepted unchanged images. Never claim images or checks that do not exist. Stop only servers you started, after all testing and captures finish.`,
				{ next: "visual-review", qaContract: QA_CONTRACT },
			),
			agent(
				"visual-review",
				"Review QA and screenshots",
				`${review}
This is a QA AND SCREENSHOT review. Return qaContract:"qa-v1" alongside the review fields. Inspect accepted business requirements and expectations, cumulative diff, planned stories, complete criterion coverage, executed test receipts, failures, blocked checks, optional observations and all retained disputes. A screenshot alone cannot prove behavior, and an agent saying passed without actual executed evidence is insufficient. Missing/blocked required QA cannot be approved. Failed required behavior requires a fix and retest even when a fixer rejects a complaint. Corrections to erroneous scenarios must match accepted requirements and record a rationale.
Open the actual selected screenshots. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good image, using its exact supplied hash. Exclude images affected by unresolved findings. Missing critical SELECTED states is rating 3; do not invent larger viewport/language/role matrices. Request only minimum targeted replacements by exact area/state. Preserve explicitly accepted unchanged image receipts and optional observations without making preferences blocking. Return complete current coverage, not merely the latest delta. Do not execute QA again, change code or recapture images.`,
				{ next: "visual-gate", qaContract: QA_CONTRACT },
			),
			tool("visual-gate", "QA and screenshot gate", "visual-gate", {
				branches: back("approved", "visual-fix"),
				next: "guide",
				qaContract: QA_CONTRACT,
			}),
			agent("code-fix", "Fix review findings", fix, { next: "code-review" }),
			agent(
				"ci-fix",
				"Fix CI failures",
				`Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using the selected Git provider (GitHub: write a token-free JSON request file with method POST, path graphql and body {query,variables}, set repoUrl to the selected HTTPS repository URL and requestFile to that file, then run ${githubApiHelper} with the resolveReviewThread mutation; GitLab: glab api PUT the MR discussion with resolved=true; custom: the configured adapter). Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-bobs-factory --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready.` +
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
			agent(
				"visual-fix",
				"Fix QA and visual findings",
				fix +
					" Include independently generated visual-gate findings as well as reviewer findings. Preserve stable dispositions. Rejected complaints require concrete evidence and reviewer reassessment; rejection cannot waive a failed required criterion. After corrections the pipeline returns through code review, CI, QA scope, execution, review and gate. Failed criteria must be retested before the human guide.",
				{ next: "code-review", qaContract: QA_CONTRACT },
			),
			agent("guide", "Prepare human review brief", briefPrompt, {
				next: "handoff",
				qaContract: QA_CONTRACT,
				guideContract: BRIEF_CONTRACT,
			}),
			tool("handoff", "Verify revision and hand off", "handoff", {
				branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				next: "human-review",
				qaContract: QA_CONTRACT,
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
const previousVideoPrompts = new Map<string, string>();
for (const step of pipeline.steps) {
	if (
		![
			"visual-scope",
			"capture",
			"visual-review",
			"visual-gate",
			"guide",
			"handoff",
		].includes(step.id)
	)
		continue;
	Object.assign(step, { videoContract: "video-v1" });
	if ("prompt" in step) {
		previousVideoPrompts.set(step.id, step.prompt);
		step.prompt +=
			"guideContract" in step
				? briefVideoInstructions
				: (videoPrompts[step.id] ?? "");
	}
}

const planStep = pipeline.steps.find((step) => step.id === "plan")!;
if (!("prompt" in planStep)) throw new Error("Stock planner unavailable");
const previousPlanPrompt = planStep.prompt;
const ticketPlanInstructions =
	" Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links.";
planStep.prompt += ticketPlanInstructions;
// Kept for conservative saved-recipe detection and legacy runtime regression fixtures.
export const legacyReviewSteps = structuredClone(pipeline.steps);
function installSpecialists(steps: Record<string, any>[]) {
	const index = steps.findIndex((s) => s.id === "code-review");
	steps.splice(index, 1, ...structuredClone(specialistSteps));
	for (const step of steps) {
		if (step.next === "code-review") step.next = "extract-requirements";
		for (const branch of step.branches ?? [])
			if (branch.next === "code-review") branch.next = "extract-requirements";
		if (step.id === "review-gate") {
			step.name = "Aggregate specialist findings and coverage";
			step.review = {
				inventory: "extract-requirements",
				fanout: "specialist-review",
			};
		}
		if (step.tool === "human-review")
			step.branches = [
				...(step.branches ?? []),
				{
					when: { path: "rework", equals: true },
					next: "extract-requirements",
				},
			];
		if (
			step.id === "visual-scope" &&
			!step.prompt.includes(inventoryQaInstructions)
		)
			step.prompt += inventoryQaInstructions;
		if (
			step.id === "guide" &&
			!step.guideContract &&
			!step.prompt.includes(inventoryGuideInstructions)
		)
			step.prompt += inventoryGuideInstructions;
	}
}
installSpecialists(pipeline.steps);
// Install only in newly accepted stock definitions; saved run snapshots are never rewritten.
const deliveryInstructions = ` Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution.`;
for (const step of pipeline.steps) {
	if (["clarify", "plan", "plan-review"].includes(step.id) && "prompt" in step)
		step.prompt += deliveryInstructions;
	if (step.id === "clarify" && "prompt" in step)
		step.prompt +=
			' Include deliveryMode:"repository"|"external"|"mixed". Do not ask to authorize unrelated repository implementation for external tasks.';
	if (step.id === "plan" && "prompt" in step)
		step.prompt += ` Include deliveryContract:{format:"delivery-v1",version:1,mode:"repository"|"external"|"mixed",authorization:{status:"authorized"|"deferred",reference:"actual instruction/answer reference"},executionReference:"digest supplied in deliveryExecutionReference",targets:[{key:"stable target ID",resource:{provider:"linear",instance:"https://linear.app",workspaceId:"configured workspace",project:"immutable project or team ID",id:"immutable UUID",url:"verified URL"} OR {provider:"taskbot",server:"configured server",instance:"exact HTTPS origin",project:"project slug",id:"numeric ID as string",url:"exact URL"},capabilities:["read","content","relationships"],baseline:{fields:{title:"observed title",description:"complete observed content"},relationships:[{type:"blocks"|"related",from:"immutable ID",to:"immutable ID"}]},operations:[{id:"stable operation ID",kind:"content",fields:{description:"full desired content"}} OR {id:"stable ID",kind:"add"|"remove",relationship:{type:"blocks"|"related",from:"ID",to:"ID"}}],criteria:[{id:"stable criterion",requirementRef:"accepted requirement reference",description:"observable acceptance criterion",fields:{description:"full expected content"},relationships:[],absentRelationships:[]}],preservedRelationships:[]}]}. Repository mode uses targets:[]; external/mixed need complete targets. Fetch complete before-state and verify coordinates through configured integrations. Do not mutate. Store no credentials. Include full expected fields and preserved relationships. On correction increment version and use new operation IDs for changed intents; retain already-applied history.`;
	if (step.id === "plan-review" && "prompt" in step)
		step.prompt +=
			" Confirm delivery mode, target identities, authorization, complete baseline, allowed operations and every criterion. Return deliveryContractDigest using the supplied deliveryCandidateDigest only when approving that exact contract. Incomplete or contradictory contracts cannot be approved.";

	if (step.id === "merge")
		Object.assign(step, {
			branches: [
				...("branches" in step ? (step.branches as any[]) : []),
				{
					when: { path: "externalPending", equals: true },
					next: "external-final",
				},
			],
		});
}
// Mixed feedback renews the external contract before repository work resumes.
const initialHumanReview = pipeline.steps.find((s) => s.id === "human-review")!;
for (const branch of (initialHumanReview as Record<string, any>).branches)
	if (branch.when.path === "decision" && branch.when.equals === "reject")
		branch.next = "delivery-feedback-route";
const planReview = pipeline.steps.find((s) => s.id === "plan-review")!;
Object.assign(planReview, { next: "delivery-route" });
(pipeline.steps as Record<string, any>[]).push(
	tool(
		"delivery-feedback-route",
		"Route requested delivery corrections",
		"delivery-mode",
		{
			branches: [
				{
					when: { path: "mode", equals: "mixed" },
					next: "external-correction",
				},
			],
			next: "human-fix",
		},
	),
	tool(
		"delivery-route",
		"Validate accepted delivery contract",
		"delivery-route",
		{
			branches: [
				{ when: { path: "deferred", equals: true }, next: "delivery-deferred" },
				{ when: { path: "mode", equals: "external" }, next: "external-apply" },
				{ when: { path: "mode", equals: "mixed" }, next: "external-apply" },
			],
			next: "implement",
		},
	),
	agent(
		"delivery-deferred",
		"Resolve execution deferral",
		"The accepted delivery contract defers execution. Do not mutate tickets or files. Ask whether the named external/repository task should remain deferred or may proceed. Return questions while the deferral remains. Read answers; only explicit authorization may return questions:[], then the planner and plan reviewer renew the contract. Never infer execution permission from scope answers.",
		{ askQuestions: true, next: "plan" },
	),
	tool("external-apply", "Apply authorized ticket changes", "external-apply", {
		next: "external-verify",
	}),
	tool(
		"external-verify",
		"Independently verify ticket state",
		"external-verify",
		{ next: "external-after-verify" },
	),
	tool(
		"external-after-verify",
		"Route verified deliverables",
		"delivery-mode",
		{
			branches: [
				{
					when: { path: "repositoryComplete", equals: true },
					next: "external-guide",
				},
				{ when: { path: "mode", equals: "mixed" }, next: "implement" },
			],
			next: "external-guide",
		},
	),
	tool("external-guide", "Prepare external review", "external-guide", {
		next: "external-human-review",
	}),
	tool(
		"external-human-review",
		"Accept completed external work",
		"human-review",
		{
			branches: [
				{
					when: { path: "decision", equals: "reject" },
					next: "external-correction",
				},
			],
			next: "external-final",
		},
	),
	agent(
		"external-correction",
		"Plan requested ticket corrections",
		"Read humanDecisions, the accepted delivery contract, operation receipts and verified state. Applied changes remain; rejection does not roll them back. Preserve feedback and before/after history. Do not mutate tickets or repository files, commit or push. Before repository merge, summarize both ticket and repository feedback for the revised plan; preserve existing repository work and let implementation apply the reviewed corrections. After repository merge, corrections on this path concern external deliverables only. Confirmed repository merges remain retained. Repository changes requested after merge need a separate follow-up, never replay publication or merge. Summarize the requested corrections for a revised plan and independent plan review.",
		{ next: "plan" },
	),
	tool("external-final", "Check accepted external state", "external-final", {
		branches: [
			{ when: { path: "drift", equals: true }, next: "external-reverify" },
		],
		next: "end",
	}),
	tool(
		"external-reverify",
		"Verify changed external state",
		"external-verify",
		{ next: "external-guide" },
	),
);
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
		// Chapter-guide stock prompts, as saved by each earlier release.
		legacyGuidePrompt + videoPrompts.guide + inventoryGuideInstructions,
		legacyGuidePrompt + videoPrompts.guide,
		legacyGuidePrompt + inventoryGuideInstructions,
		legacyGuidePrompt,
		// The QA stock guide saved before compact content was required.
		legacyGuidePrompt.split("\nEvery new guide MUST")[0]!,
		`Write a complete, guided human review of the WHOLE PR at the current revision, including work that existed before takeover and every accepted iteration. This is a product walkthrough, not a recap of the last fix. First read /progress/reviewScope, the clarified requirements, decisions, accepted plan and cumulative capture inventory through factory-context. Inspect the actual base-to-head PR diff, grouping changes by feature/purpose rather than file or review iteration. The first guide always covers the entire feature. Put the core behavior first, consequences next, and supporting changes last.
Return {"goal":"user goal, at most 30 words","summary":"whole-PR outcome, at most 30 words","decision":{"status":"ready or needs-attention or blocked","summary":"at most 30 words"},"chapters":[{"id":"stable-feature-id","title":"short feature name","summary":"what changed and why, at most 40 words","before":"short original behavior","after":"short new behavior","requirementIndexes":[0],"files":["exact changed repository-relative file"],"screenshots":[{"area":"exact capture area","state":"exact capture state","caption":"what the human should notice"}],"diagrams":[{"title":"how this feature works","steps":[{"label":"short stage","detail":"one short sentence"}]}],"reviewChecks":["specific, short thing to verify"],"risks":["material limitation of this feature"],"evidence":["technical references/test receipts for expandable details"]}],"requirements":[{"criterion":"complete original acceptance criterion","status":"supported or gap or unverified or waived","evidence":["actual evidence"]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks, distinguish current-head CI from earlier local test receipts"],"risks":["material limitations and retained disagreements"],"reviewInstructions":["short final decision checks"]}.
Produce a small set of cohesive chapters (usually 4-10), one changed thing per chapter. Each requirement must be assigned to at least one chapter using zero-based requirementIndexes. Account for all changed files in chapter files, including tests/migrations/docs and inherited takeover work; supporting files may share a chapter. Use exact relative paths, no globs. Use real cumulative screenshots attached to their relevant chapter, not arbitrary first images or local Markdown image URLs. Keep the whole accepted inventory discoverable, but choose only the useful captures for each chapter. Explain nonvisual processing with a short flow diagram where it helps (e.g. input -> captured terms -> billing -> receipt); diagrams describe the product, not the factory pipeline. No decorative diagrams or invented evidence. Use everyday words; IDs, SHAs, long code descriptions and raw receipts belong in expandable evidence. Disclose fixture/hardware limitations and rejected scope complaints clearly.
On repeats, update affected chapters and retain unchanged feature chapters, requirements and evidence. A short revision summary may supplement a complete previous guide ONLY when a previous guide was actually human-reviewed and the actual change is a verified typo/documentation-only correction of at most 10 lines with no behavior, visual, dependency or configuration change. Never replace full feature coverage with the revision delta. Set revisionSummary=true and previousHeadSha only for that case, and put its short delta in revisionNote while summary still describes the entire feature. Require fresh explicit human approval of the current revision. Do not modify product code, recapture screenshots, rerun implementation or merge. Human-only merge blockers are remaining human actions, not unsupported implementation requirements.`,
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
		// Handoff became a passive poller. Normalize formerly valid saved recipe
		// classifications before validation, including custom fanout branches.
		// This upgrade is not applied to immutable accepted run definitions.
		const upgradeHandoffCapacity = (items: Record<string, unknown>[]): void => {
			for (const step of items) {
				if (
					step.type === "tool" &&
					step.tool === "handoff" &&
					step.computeIntensive === true
				)
					step.computeIntensive = false;
				if (Array.isArray(step.groups))
					for (const group of step.groups)
						if (Array.isArray(group)) upgradeHandoffCapacity(group);
			}
		};
		upgradeHandoffCapacity(steps);
		if (!["factory-pipeline", "factory"].includes(String(definition.id)))
			continue;
		const stockQa = defaultWorkflows.find(
			(w) => w.id === "factory-pipeline",
		)!.steps;
		const affected = legacyScreenshotSteps.map((s) => s.id);
		const coherentStock = affected.every((id) => {
			const step = steps.find((s) => s.id === id);
			const old = legacyScreenshotSteps.find((s) => s.id === id)!;
			const current = stockQa.find((s) => s.id === id)!;
			if (
				!step ||
				step.type !== old.type ||
				(step.type === "agent" &&
					((step.json ?? true) !== (old.json ?? true) ||
						(step.askQuestions ?? false) !== (old.askQuestions ?? false))) ||
				(step.inputs !== undefined &&
					JSON.stringify(step.inputs) !== JSON.stringify(old.inputs))
			)
				return false;
			const promptMatches =
				step.type === "tool"
					? step.tool === old.tool
					: step.prompt === old.prompt ||
						step.prompt === current.prompt ||
						step.prompt ===
							current.prompt?.replace(videoPrompts[id] ?? "", "") ||
						step.prompt === previousVideoPrompts.get(id) ||
						step.prompt ===
							(
								legacyReviewSteps.find((s) => s.id === id) as
									| { prompt?: string }
									| undefined
							)?.prompt ||
						(legacyVisualPrompts[id] ?? []).includes(String(step.prompt));
			const routeMatches =
				(step.next === old.next ||
					step.next === current.next ||
					(id === "handoff" && step.next === "end")) &&
				[
					JSON.stringify(old.branches),
					...(step.qaContract || id === "handoff"
						? [JSON.stringify(current.branches)]
						: []),
				].includes(JSON.stringify(step.branches ?? []));
			return (
				promptMatches &&
				routeMatches &&
				(!step.qaContract || step.qaContract === QA_CONTRACT)
			);
		});
		if (coherentStock)
			for (const step of steps) {
				if (!affected.includes(String(step.id) as (typeof affected)[number]))
					continue;
				const stock = stockQa.find((s) => s.id === step.id)!;
				Object.assign(step, {
					name: stock.name,
					qaContract: stock.qaContract,
					...(stock.videoContract
						? { videoContract: stock.videoContract }
						: {}),
					...(stock.guideContract
						? { guideContract: stock.guideContract }
						: {}),
					branches: structuredClone(
						step.id === "handoff" ? (step.branches ?? []) : stock.branches,
					),
					...(stock.prompt ? { prompt: stock.prompt } : {}),
					...(stock.next
						? {
								next:
									stock.next === "extract-requirements" &&
									steps.some((s) => s.id === "code-review")
										? "code-review"
										: stock.next,
							}
						: {}),
				});
				if (!stock.next) delete step.next;
				if (
					step.id === "handoff" &&
					!steps.some((s) => s.id === "human-review")
				)
					step.next = "end";
			}
		for (const step of steps) {
			if (step.id === "plan" && step.prompt === previousPlanPrompt)
				step.prompt = previousPlanPrompt + ticketPlanInstructions;
			const stock = defaultWorkflows
				.find((item) => item.id === "factory-pipeline")!
				.steps.find((item) => item.id === step.id);
			if (
				step.id === "clarify" &&
				(step.prompt ===
					stock!.prompt!.replace(
						'"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],',
						"",
					) ||
					step.prompt ===
						`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. Do not assume answers or implement anything. Return {"questions":["..."],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. Empty questions means everything is understood. Preserve all answered decisions across rounds.`)
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
					step.name === legacyReviewSteps.find((s) => s.id === step.id)?.name ||
					(step.id === "ci" && step.name === "Watch pull request CI"))
			)
				step.maxVisits = stock.maxVisits;
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
			steps.push({
				...structuredClone(
					defaultWorkflows
						.find((item) => item.id === "factory-pipeline")!
						.steps.find((step) => step.id === "after-ci-fix")!,
				),
				next: "code-review",
			} as unknown as Record<string, unknown>);
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
		upgradeHandoffReadiness(steps as unknown as WorkflowStep[]);
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
	for (const definition of definitions) {
		if (
			!["factory-pipeline", "factory"].includes(String(definition.id)) ||
			!Array.isArray(definition.steps)
		)
			continue;
		const steps = definition.steps as Record<string, any>[];
		const reviewer = steps.find((s) => s.id === "code-review");
		const gate = steps.find((s) => s.id === "review-gate");
		const old = legacyReviewSteps.find((s) => s.id === "code-review")!;
		// Do not overwrite a customized reviewer, source restriction, output setting or graph.
		const stockReviewer =
			reviewer &&
			reviewer.prompt === review &&
			reviewer.name === old.name &&
			reviewer.type === "agent" &&
			![
				"runner",
				"model",
				"reasoningEffort",
				"modelVariant",
				"serviceTier",
				"inputs",
				"chat",
				"reviewContract",
				"review",
			].some((k) => reviewer[k] !== undefined) &&
			reviewer.json !== false &&
			!reviewer.askQuestions &&
			!reviewer.next &&
			!reviewer.branches?.length &&
			(reviewer.maxVisits ?? 8) === 8;
		const stockGate =
			gate &&
			gate.tool === "review-gate" &&
			!gate.args?.length &&
			!gate.arguments &&
			!gate.review &&
			!gate.next &&
			JSON.stringify(gate.branches ?? []) ===
				JSON.stringify([
					{ when: { path: "approved", equals: false }, next: "code-fix" },
				]);
		const compatibleConsumers =
			steps.every(
				(s) =>
					!(s.inputs ?? []).some((path: string) =>
						path.includes("code-review"),
					),
			) &&
			["visual-scope", "guide"].every((id) => {
				const step = steps.find((s) => s.id === id);
				const previous = legacyReviewSteps.find((s) => s.id === id);
				const current = defaultWorkflows
					.find((w) => w.id === "factory-pipeline")!
					.steps.find((s) => s.id === id);
				return (
					!step ||
					(previous &&
						"prompt" in previous &&
						step.prompt === previous.prompt) ||
					step.prompt === current?.prompt
				);
			});
		if (
			stockReviewer &&
			stockGate &&
			compatibleConsumers &&
			!steps.some((s) =>
				["extract-requirements", "specialist-review"].includes(s.id),
			)
		)
			installSpecialists(steps);
	}
	return definitions;
}

/** Extend only the stock handoff route to reuse its already-authorized CI fixer. */
export function upgradeHandoffReadiness(steps: WorkflowStep[]): boolean {
	const handoff = steps.find((step) => step.tool === "handoff");
	const ci = steps.find((step) => step.tool === "ci");
	if (
		!handoff ||
		handoff.branches?.length ||
		(handoff.next && !["end", "human-review"].includes(handoff.next)) ||
		!steps.some((step) => step.id === "ci-fix") ||
		!ci?.branches.some(
			(branch) =>
				branch.next === "ci-fix" &&
				branch.when.path === "fix" &&
				branch.when.equals === true,
		)
	)
		return false;
	handoff.branches = [{ when: { path: "fix", equals: true }, next: "ci-fix" }];
	return true;
}
