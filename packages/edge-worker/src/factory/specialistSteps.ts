const shared = `Read /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.
Return {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.`;
export const extractionPrompt = `Extract scope independently of the implementation. Read complete originalInput (parse embedded JSON), ticket/acceptance criteria, ALL paginated comments, attachments/assets, clarification answers and accepted decisions/plan, later chat/human steering, takeover/PR discussions and past review rounds/dispositions through factory-context. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for historical claims and reasoning, following original outputPath records when scope or disagreement evidence is needed. Follow nextOffset to null. Missing source access requires a concrete questions entry; never omit unavailable scope. Read previous inventories, retain every historical ID and decision, and record amendments/supersessions with changeReason. Suggestions are not accepted scope. Contradictions stay in conflicts and questions until explicitly resolved outside fanout. Scope decisions require the actual accepting person, rationale and source, not a reviewer preference. Use kind:"skip" only for an explicit scope waiver, and list the precise requirementIds it authorizes skipping; other accepted scope decisions use kind:"scope". List considered sources and unavailable sources in sourceReceipt. Semantic extraction completeness needs source inspection; structural validation alone cannot prove it.
Return {"schemaVersion":1,"requirements":[{"id":"R1","criterion":"testable accepted outcome","classification":"active or suggestion or superseded","sources":[{"source":"originalInput or context record or source URL","reference":"JSON Pointer/comment/attachment identifier"}],"changeReason":"required for an amendment","supersedes":[]}],"decisions":[{"id":"D1","acceptedBy":"person who explicitly accepted","kind":"scope or skip","requirementIds":["R1"],"rationale":"accepted scope rationale","source":{"source":"source","reference":"record identifier"}}],"conflicts":[{"id":"C1","description":"unresolved scope question","sources":[{"source":"source","reference":"record"}]}],"sourceReceipt":{"considered":[{"source":"source","reference":"record"}],"unavailable":[]},"questions":[]}. Runtime owns inventory version/digest. Do not change product files.`;
const specialists = [
	[
		"security-review",
		"Security and data protection",
		"Own authorization, trust boundaries, secrets, untrusted input and consequential data exposure. Avoid general style or business scope review.",
	],
	[
		"architecture-review",
		"Architecture and module boundaries",
		"Own responsibilities, dependency direction, domain/API seams and interface compatibility. Avoid speculative redesign and local style.",
	],
	[
		"integration-review",
		"Repository fit and integration",
		"Own repository conventions, established reuse, config/migration wiring and surrounding integrations. Identify concrete omitted integration sites.",
	],
	[
		"simplicity-review",
		"Simplicity and maintainability",
		"Own unnecessary abstraction, duplication, speculative extensibility and disproportionate complexity. Explain maintenance cost and a smaller sufficient alternative.",
	],
	[
		"correctness-review",
		"Correctness and verification",
		"Own behavioral failures, boundaries, state/concurrency, error handling and actual verification gaps. Ground complaints in reproduction or code evidence.",
	],
	[
		"requirements-review",
		"Business requirements and acceptance",
		"Own complete acceptance coverage. Assess EVERY active requirement exactly once; preserve superseded/suggestion records as context. Return coverage:[{requirementId,status:'met or not_met or deliberately_skipped',evidence:['concrete evidence at frozen revision'],reason:'why',decisionId:'accepted decision for deliberate skip'}] alongside review fields. Missing or inconclusive evidence is not_met, with an actionable open rating 2/3 finding referencing the ID. A skip needs an explicitly accepted decision, accepting person and rationale. Do not let reviewer/fixer preference waive scope.",
	],
];
export const specialistSteps = [
	{
		id: "extract-requirements",
		name: "Extract requirements",
		type: "agent",
		prompt: extractionPrompt,
		reviewContract: "inventory-v1",
		askQuestions: true,
	},
	{
		id: "specialist-review",
		name: "Parallel specialist review",
		type: "fanout",
		review: { inventory: "extract-requirements" },
		groups: specialists.map(([id, name, brief]) => [
			{
				id,
				name,
				type: "agent",
				prompt: `${brief}\n${shared}`,
				reviewContract:
					id === "requirements-review" ? "coverage-v1" : "specialist-v1",
			},
		]),
	},
];
export const inventoryQaInstructions = ` For specialist review runs, use the frozen review-gate.baseline.inventory active stable IDs as requirementRefs. Every active ID needs a relevant executable story or a justified exclusion, including accepted skips. QA exclusion does not waive scope. Earlier business coverage cannot override failed/blocked required QA.`;
export const inventoryGuideInstructions = ` For specialist review runs, author requirements in the exact active frozen inventory order, with requirementId and the exact criterion. Map chapter requirementIndexes to this order. Evidence and statuses must agree with review-gate coverage; met is supported, not_met is gap, deliberately_skipped is waived and cites the accepted decision/person/rationale. Executed QA failures or blockers still prevent readiness. Runtime attaches complete validated coverage, specialist observations, disputes and QA receipts for expandable evidence. Never invent coverage or upgrade gaps.`;
