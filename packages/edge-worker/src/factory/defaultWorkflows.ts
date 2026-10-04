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
	...extra,
});
const back = (path: string, next: string) => [
	{ when: { path, equals: false }, next },
];

const review = `Review the current diff against the accepted plan. You receive ALL historical review rounds and fixer responses. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.`;
const fix = `Fix all open rating 2/3 findings. You receive ALL past findings and fixer dispositions; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"..."}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.`;

export const defaultWorkflows = validateWorkflows([
	{
		id: "simple",
		name: "Simple / Cyrus",
		description:
			"The existing Cyrus run, with its original prompts, skills and runner lifecycle.",
		labels: ["workflow:simple"],
		steps: [],
	},
	{
		id: "factory",
		name: "Software factory",
		description:
			"Clarify → plan → implement → draft PR → review → CI → visual review → human guide.",
		labels: ["workflow:factory", "factory"],
		steps: [
			agent(
				"clarify",
				"Clarify requirements",
				`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. Do not assume answers or implement anything. Return {"questions":["..."],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. Empty questions means everything is understood. Preserve all answered decisions across rounds.`,
				{ askQuestions: true },
			),
			tool("decisions", "Record decisions", "record-decisions"),
			agent(
				"plan",
				"Write implementation plan",
				`Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. Do not implement.`,
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
				`Implement the provided plan and use its assets. Follow repository conventions and appropriate verification. Return {"summary":"...","checks":["commands and outcomes"]}. Do not create or publish a PR; the next step handles delivery.`,
				{ inputs: ["plan"] },
			),
			tool("draft-pr", "Push and create draft PR", "draft-pr"),
			agent("code-review", "Review code", review),
			tool("review-gate", "Discard nitpicks / review gate", "review-gate", {
				branches: back("approved", "code-fix"),
			}),
			tool("ci", "Watch pull request CI", "ci", {
				branches: back("approved", "ci-fix"),
			}),
			agent(
				"visual-scope",
				"Identify visual changes",
				`Inspect the exact PR diff and decide whether application visuals changed. Return {"changed":false,"areas":[]} for no visual changes, otherwise {"changed":true,"areas":[{"name":"region or element","url":"path/URL or application view","states":["desktop, mobile, relevant interaction states"],"instructions":"how to access and what changed"}]}. Be precise and exhaustive. Do not change code or take screenshots.`,
				{ branches: back("changed", "guide") },
			),
			agent(
				"capture",
				"Capture changed areas",
				`Start the dev application as needed. Use available browser/screenshot tools to capture EVERY area and relevant state in visual-scope. Save image files under the provided evidence directory, with a fresh filename for each revision. Inspect the captures for readability. Return {"screenshots":[{"path":"absolute path","caption":"area/state","area":"name","state":"exact state from the area inventory"}],"unavailable":[{"area":"name","reason":"concrete reason"}]}. Never claim captures that do not exist. Stop any dev server you started before finishing. Do not change product code. Missing capture tooling must be reported in unavailable.`,
				{ next: "visual-review" },
			),
			agent(
				"visual-review",
				"Review screenshots",
				`${review}\nThis is a VISUAL review: open and inspect the actual screenshots, checking each requested area/state against the plan. Include areas with missing/unavailable capture evidence as rating 3 findings. Never approve missing screenshots.`,
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
				`Diagnose and fix the CI failures in the supplied receipts and full past review history. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."]}. Do not merge or mark ready.`,
				{ next: "code-review" },
			),
			agent("visual-fix", "Fix visual findings", fix, { next: "code-review" }),
			agent(
				"guide",
				"Prepare human review guide",
				`Write a Rocky-inspired review recap for the exact current PR revision, grounded in the supplied results/evidence. Return {"goal":"short user goal","summary":"short outcome","decision":{"status":"ready or needs-attention or blocked","summary":"..."},"requirements":[{"criterion":"...","status":"supported or gap or unverified","evidence":["..."]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks and CI results"],"risks":["actual limitations"],"reviewInstructions":["where to look and what to verify"]}. Include decisions, accepted/rejected review complaints, real screenshots where UI changed and remaining human actions. Never invent successful checks, screenshots or coverage. Use plain language. The PR stays draft for the human.`,
				{ next: "handoff" },
			),
			tool("handoff", "Verify revision and hand off", "handoff", {
				next: "end",
			}),
		],
	},
]);
