// Frozen stock screenshot contracts used only to recognize safe recipe upgrades.
import type { WorkflowStep } from "./Workflow.js";

export const legacyScreenshotSteps: WorkflowStep[] = [
	{
		id: "visual-scope",
		name: "Identify visual changes",
		branches: [
			{
				when: {
					path: "changed",
					equals: false,
				},
				next: "guide",
			},
		],
		maxVisits: 8,
		type: "agent",
		prompt:
			'Inspect the exact PR diff and decide whether application visuals changed. Return {"changed":false,"areas":[]} for no visual changes, otherwise {"changed":true,"areas":[{"name":"region or element","url":"path/URL or application view","states":["mobile EN drawer with long names"],"instructions":"how to access and what changed"}]}. Enumerate every visually changed area, but select a SMALL REPRESENTATIVE evidence set: normally 1–2 concrete states per area and at most 24 screenshots total. Each state must be a single exact capture description, e.g. mobile EN drawer with long names; never list comma-separated alternatives or a Cartesian matrix of sizes × languages × permissions × errors. One screenshot can cover several elements; group co-visible regions. Add desktop+mobile only when both layouts materially differ; capture another language/theme only for distinct changed layout risk. Validate permissions, every error path and numeric edge cases with automated tests instead of extra screenshots unless their visual rendering changed. Prioritize changed happy path and the highest-risk visual edge case. Return captureBudget=24; an unusually broad feature may use up to 48 only with a concrete budgetReason explaining why representative evidence cannot fit. Include per-area rationale/dependencies. Do not change code or take screenshots.',
		json: true,
		askQuestions: false,
	},
	{
		id: "capture",
		name: "Capture changed areas",
		next: "visual-review",
		branches: [],
		maxVisits: 8,
		type: "agent",
		prompt:
			'Start the dev application as needed. Use available browser/screenshot tools to capture exactly the representative area/state inventory in visual-scope, within its captureBudget (normally 24). Do not expand combined state labels into combinations, invent extra states, or generate intermediate/debug images as review evidence. For a resumed legacy inventory without captureBudget, preserve its selected coverage and existing evidence; do not create an additional combinatorial matrix. The budget applies to the next compact visual-scope plan, not retroactively to an in-flight legacy capture. Do not classify deliberately redundant test combinations as missing critical visual evidence. One final image per selected area/state; replace bad attempts and keep only useful images in the returned inventory. Do not take routine tablet/language/role duplicates unless their layout changed. When subagent tools are available and multiple areas can be captured independently, use up to 3 subagents in parallel to speed up capture. Set up the application once, then give each subagent a disjoint area/state assignment, the exact revision, application URL/access instructions, required assets and evidence directory. Share the dev server; use separate browser pages/contexts where supported. If browser control is shared, serialize interactions to avoid interfering with each other\'s captures. Each subagent must capture and inspect its assigned areas, use unique filenames, report real image paths and any unavailable states, and leave shared server cleanup to you. If delegation or independent capture is unsupported, capture sequentially yourself. Wait for all subagents, inspect their results, and merge them into one complete inventory without duplicates or missing states. Save image files under the provided evidence directory, with a fresh filename for each revision. Inspect the captures for readability. Return {"screenshots":[{"path":"absolute path","caption":"area/state","area":"name","state":"exact state from the area inventory"}],"unavailable":[{"area":"name","reason":"concrete reason"}]}. Never claim captures that do not exist. Stop any dev server you started only after all captures finish. Do not change product code. Missing capture tooling must be reported in unavailable.',
		json: true,
		askQuestions: false,
	},
	{
		id: "visual-review",
		name: "Review screenshots",
		next: "visual-gate",
		branches: [],
		maxVisits: 8,
		type: "agent",
		prompt:
			'Review the current diff against the accepted plan. You receive ALL historical review rounds and fixer responses. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.\nThis is a VISUAL review: open and inspect the actual screenshots, checking the agreed representative evidence plan and current changed visual risks. Do not demand all combinations of viewport, language, role or error states, or invent a larger screenshot matrix. Use actual test receipts for logic/permissions. Missing a critical selected visual state is a rating 3 finding; a redundant matrix combination or intentionally omitted nonvisual test case is not. Never approve genuinely missing critical evidence. Request the minimum targeted replacement needed for a finding, identifying exact area/state. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good screenshot, using its supplied exact hash. Exclude any screenshot affected by an unresolved finding. These receipts allow unchanged good evidence to survive a local visual fix. Preserve accepted evidence and do not demand a full recapture after a local correction.',
		json: true,
		askQuestions: false,
	},
	{
		id: "visual-gate",
		name: "Visual review gate",
		next: "guide",
		branches: [
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "visual-fix",
			},
		],
		maxVisits: 100,
		type: "tool",
		tool: "visual-gate",
		args: [],
	},
	{
		id: "visual-fix",
		name: "Fix visual findings",
		next: "code-review",
		branches: [],
		maxVisits: 8,
		type: "agent",
		prompt:
			'Fix all open rating 2/3 findings. You receive ALL past findings and fixer dispositions; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"..."}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.',
		json: true,
		askQuestions: false,
	},
	{
		id: "guide",
		name: "Prepare human review guide",
		next: "handoff",
		branches: [],
		maxVisits: 8,
		type: "agent",
		prompt:
			'Write a complete, guided human review of the WHOLE PR at the current revision, including work that existed before takeover and every accepted iteration. This is a product walkthrough, not a recap of the last fix. First read /progress/reviewScope, the clarified requirements, decisions, accepted plan and cumulative capture inventory through factory-context. Inspect the actual base-to-head PR diff, grouping changes by feature/purpose rather than file or review iteration. The first guide always covers the entire feature. Put the core behavior first, consequences next, and supporting changes last.\nReturn {"goal":"user goal, at most 30 words","summary":"whole-PR outcome, at most 30 words","decision":{"status":"ready or needs-attention or blocked","summary":"at most 30 words"},"chapters":[{"id":"stable-feature-id","title":"short feature name","summary":"what changed and why, at most 40 words","before":"short original behavior","after":"short new behavior","requirementIndexes":[0],"files":["exact changed repository-relative file"],"screenshots":[{"area":"exact capture area","state":"exact capture state","caption":"what the human should notice"}],"diagrams":[{"title":"how this feature works","steps":[{"label":"short stage","detail":"one short sentence"}]}],"reviewChecks":["specific, short thing to verify"],"risks":["material limitation of this feature"],"evidence":["technical references/test receipts for expandable details"]}],"requirements":[{"criterion":"complete original acceptance criterion","status":"supported or gap or unverified or waived","evidence":["actual evidence"]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks, distinguish current-head CI from earlier local test receipts"],"risks":["material limitations and retained disagreements"],"reviewInstructions":["short final decision checks"]}.\nProduce a small set of cohesive chapters (usually 4-10), one changed thing per chapter. Each requirement must be assigned to at least one chapter using zero-based requirementIndexes. Account for all changed files in chapter files, including tests/migrations/docs and inherited takeover work; supporting files may share a chapter. Use exact relative paths, no globs. Use real cumulative screenshots attached to their relevant chapter, not arbitrary first images or local Markdown image URLs. Keep the whole accepted inventory discoverable, but choose only the useful captures for each chapter. Explain nonvisual processing with a short flow diagram where it helps (e.g. input -> captured terms -> billing -> receipt); diagrams describe the product, not the factory pipeline. No decorative diagrams or invented evidence. Use everyday words; IDs, SHAs, long code descriptions and raw receipts belong in expandable evidence. Disclose fixture/hardware limitations and rejected scope complaints clearly.\nOn repeats, update affected chapters and retain unchanged feature chapters, requirements and evidence. A short revision summary may supplement a complete previous guide ONLY when a previous guide was actually human-reviewed and the actual change is a verified typo/documentation-only correction of at most 10 lines with no behavior, visual, dependency or configuration change. Never replace full feature coverage with the revision delta. Set revisionSummary=true and previousHeadSha only for that case, and put its short delta in revisionNote while summary still describes the entire feature. Require fresh explicit human approval of the current revision. Do not modify product code, recapture screenshots, rerun implementation or merge. Human-only merge blockers are remaining human actions, not unsupported implementation requirements.',
		json: true,
		askQuestions: false,
	},
	{
		id: "handoff",
		name: "Verify revision and hand off",
		next: "human-review",
		branches: [],
		maxVisits: 100,
		type: "tool",
		tool: "handoff",
		args: [],
	},
];
