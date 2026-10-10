import { feedbackPolicyInstructions } from "./FeedbackPolicy.js";
import {
	BRIEF_CONTRACT,
	briefPrompt,
	briefVideoInstructions,
} from "./GuideAuthoring.js";
import { takeoverLaunchFields } from "./LaunchFields.js";
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
		step.prompt +=
			"guideContract" in step
				? briefVideoInstructions
				: (videoPrompts[step.id] ?? "");
	}
}

const planStep = pipeline.steps.find((step) => step.id === "plan")!;
if (!("prompt" in planStep)) throw new Error("Stock planner unavailable");
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
