import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { factoryRuntimeIdentity } from "bobs-factory-core";
import { z } from "zod";
import {
	type AgentSettings,
	AgentSettingsSchema,
	resolveAgentSettings,
} from "./AgentSettings.js";
import { defaultWorkflows, legacyReviewSteps } from "./defaultWorkflows.js";
import historicalDigests from "./historicalWorkflowDigests.json" with {
	type: "json",
};
import { getLaunchFields } from "./LaunchFields.js";
import {
	StepSchema,
	validateWorkflows,
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
} from "./Workflow.js";

const settingsKeys = [
	"runner",
	"model",
	"reasoningEffort",
	"modelVariant",
	"serviceTier",
] as const;
const reserved = new Map(defaultWorkflows.map((w) => [w.id, w]));
const preference = z.record(z.string(), AgentSettingsSchema.strict());
const provenance = z.object({
	source: z.string(),
	version: z.string().optional(),
	digest: z.string(),
	dependencies: z.record(z.string(), z.string()),
	kind: z.enum(["fork", "migration"]),
});
const envelopeSchema = z
	.object({
		format: z.literal("workflow-catalog-v1"),
		locals: z.array(WorkflowSchema),
		preferences: z.record(z.string(), preference),
		launch: z.record(
			z.string(),
			z.object({
				labels: z.array(z.string().min(1)),
				allowedTriggers: z.array(
					z.enum(["manual", "ticket-assignment", "workflow"]),
				),
			}),
		),
		enabled: z.record(z.string(), z.boolean()),
		defaultWorkflow: z.string(),
		order: z.array(z.string()),
		provenance: z.record(z.string(), provenance),
		inactive: z.array(
			z.object({
				workflow: z.string(),
				role: z.string(),
				settings: AgentSettingsSchema,
				reason: z.string(),
			}),
		),
		migration: z
			.object({
				digest: z.string(),
				backup: z.string(),
				mappings: z.record(z.string(), z.string()),
				conflicts: z.record(z.string(), z.string()),
			})
			.optional(),
	})
	.strict();
export type WorkflowConfiguration = z.infer<typeof envelopeSchema>;
export interface WorkflowBlock {
	workflowIds: string[];
	reason: string;
	at: string;
	priorStatus?: string;
}
const digest = (value: unknown) =>
	createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value))
		.digest("hex");
function durableWrite(path: string, bytes: string, exclusive = false) {
	const fd = openSync(path, exclusive ? "wx" : "w", 0o600);
	try {
		writeFileSync(fd, bytes);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function atomic(path: string, value: unknown) {
	const temp = `${path}.tmp`;
	durableWrite(temp, JSON.stringify(value, null, 2));
	renameSync(temp, path);
	const fd = openSync(dirname(path), "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
export function workflowRoles(
	steps: WorkflowStep[],
	parent = "",
): { role: string; step: WorkflowStep }[] {
	return steps.flatMap((step) => {
		const role = `${parent}${step.id}`;
		// Branch identity uses the semantic descendant IDs, never group positions.
		return [
			...(step.type === "agent" ? [{ role, step }] : []),
			...(step.groups ?? []).flatMap((group) =>
				workflowRoles(group, `${role}/`),
			),
		];
	});
}
function extract(workflow: Workflow): Record<string, AgentSettings> {
	return Object.fromEntries(
		workflowRoles(workflow.steps)
			.map(({ role, step }) => [role, AgentSettingsSchema.parse(step)] as const)
			.filter(([, settings]) => Object.keys(settings).length),
	);
}
function behavior(workflow: Workflow): Workflow {
	const result = structuredClone(workflow);
	result.labels = [];
	result.allowedTriggers = [];
	const passive = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			if (step.tool === "handoff") delete step.computeIntensive;
			for (const group of step.groups ?? []) passive(group);
		}
	};
	passive(result.steps);
	for (const { step } of workflowRoles(result.steps))
		for (const key of settingsKeys) delete step[key];
	return result;
}
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}
function normalizeLegacy(workflow: Workflow): Workflow {
	const result = structuredClone(workflow);
	if (result.id === "simple" && result.chat === undefined) result.chat = true;
	const stock = reserved.get(result.id);
	const fields = result.launchFields?.filter((field) => field.name !== "title");
	if (stock && fields && isDeepStrictEqual(fields, getLaunchFields(stock))) {
		if (stock.launchFields === undefined) delete result.launchFields;
		else result.launchFields = stock.launchFields;
	}
	const visit = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			if (
				step.type === "tool" &&
				step.tool === "handoff" &&
				step.computeIntensive === true
			)
				step.computeIntensive = false;
			for (const group of step.groups ?? []) visit(group);
		}
	};
	visit(result.steps);
	return result;
}
function recognizedStock(workflow: Workflow): boolean {
	const hashes: Record<string, Record<string, string>> = historicalDigests;
	if (hashes[workflow.id]?.[digest(canonical(behavior(workflow)))]) return true;
	workflow = normalizeLegacy(workflow);
	const current = reserved.get(workflow.id);
	if (!current) return false;
	const templates = [current];
	if (["factory", "factory-pipeline"].includes(workflow.id)) {
		const pipeline = reserved.get("factory-pipeline")!;
		templates.push({ ...current, steps: pipeline.steps });
		templates.push({
			...current,
			steps: legacyReviewSteps.map((step) => StepSchema.parse(step)),
		});
	}
	return templates.some((template) =>
		isDeepStrictEqual(behavior(workflow), behavior(template)),
	);
}
function closure(root: Workflow, definitions: Workflow[]): Workflow[] {
	const byId = new Map(definitions.map((w) => [w.id, w]));
	const visited = new Map<string, Workflow>();
	const visit = (w: Workflow) => {
		if (visited.has(w.id)) return;
		visited.set(w.id, w);
		const walk = (steps: WorkflowStep[]) => {
			for (const step of steps) {
				if (step.type === "workflow") {
					const child = byId.get(step.workflow!);
					if (!child)
						throw new Error(`Missing workflow dependency: ${step.workflow}`);
					visit(child);
				}
				for (const group of step.groups ?? []) walk(group);
			}
		};
		walk(w.steps);
	};
	visit(root);
	return [...visited.values()];
}
function rewrite(steps: WorkflowStep[], mappings: Record<string, string>) {
	for (const step of steps) {
		if (step.workflow && mappings[step.workflow])
			step.workflow = mappings[step.workflow];
		for (const group of step.groups ?? []) rewrite(group, mappings);
	}
}
function empty(): WorkflowConfiguration {
	return {
		format: "workflow-catalog-v1",
		locals: [],
		preferences: {},
		launch: {},
		enabled: {},
		defaultWorkflow: "simple",
		order: defaultWorkflows.map((w) => w.id),
		provenance: {},
		inactive: [],
	};
}

/** Installed behavior and operator-owned data meet only in this resolver. */
export class WorkflowCatalog {
	private path: string;
	private blocksPath: string;
	private blocks: Record<string, WorkflowBlock>;
	private state: WorkflowConfiguration;
	constructor(directory: string) {
		mkdirSync(directory, { recursive: true });
		this.path = join(directory, "workflows.json");
		this.blocksPath = join(directory, "workflow-blocks.json");
		this.blocks = existsSync(this.blocksPath)
			? z
					.record(
						z.string(),
						z.object({
							workflowIds: z.array(z.string()),
							reason: z.string(),
							at: z.string(),
							priorStatus: z.string().optional(),
						}),
					)
					.parse(JSON.parse(readFileSync(this.blocksPath, "utf8")))
			: {};
		if (!existsSync(this.path)) {
			this.state = empty();
			this.validate(this.state);
			atomic(this.path, this.state);
			return;
		}
		const bytes = readFileSync(this.path, "utf8");
		const source = JSON.parse(bytes);
		if (source.format === "workflow-catalog-v1") {
			this.state = envelopeSchema.parse(source);
			this.reconcile(this.state);
			this.validate(this.state);
			atomic(this.path, this.state);
			return;
		}
		const result = this.migrate(source, bytes);
		// Original bytes and the deterministic receipt are durable before replacement.
		const backup = result.migration!.backup;
		if (existsSync(backup) && readFileSync(backup, "utf8") !== bytes)
			throw new Error(
				"Workflow migration backup collision; original configuration retained",
			);
		if (!existsSync(backup)) durableWrite(backup, bytes, true);
		this.validate(result);
		atomic(
			join(directory, `workflow-migration-${result.migration!.digest}.json`),
			result.migration,
		);
		atomic(this.path, result);
		this.state = result;
	}
	private migrate(source: unknown, bytes: string): WorkflowConfiguration {
		const document = z
			.union([
				z.array(z.unknown()),
				z.object({
					workflows: z.array(z.unknown()),
					defaultWorkflow: z.string().optional(),
				}),
			])
			.parse(source);
		const sourceWorkflows = (
			Array.isArray(document) ? document : document.workflows
		).map((w) => WorkflowSchema.parse(w));
		if (
			new Set(sourceWorkflows.map((w) => w.id)).size !== sourceWorkflows.length
		)
			throw new Error(
				"Duplicate workflow identities; migration cannot choose a safe mapping",
			);
		const result = empty();
		const hash = digest(bytes);
		const mappings: Record<string, string> = {};
		const conflicts: Record<string, string> = {};
		const occupied = new Set([
			...reserved.keys(),
			...sourceWorkflows.map((w) => w.id),
		]);
		for (const w of sourceWorkflows) {
			if (!reserved.has(w.id) || recognizedStock(w)) continue;
			if (w.id === "simple") {
				conflicts.simple =
					"Legacy Simple contains custom behavior. Inspect the original backup, then explicitly choose bundled native Simple in Recipes to resolve this conflict. Simple cannot be forked.";
				continue;
			}
			const target = `legacy-${w.id}-${hash.slice(0, 10)}`;
			if (occupied.has(target))
				throw new Error(`Migration identity collision: ${target}`);
			occupied.add(target);
			mappings[w.id] = target;
		}
		let changed = true;
		while (changed) {
			changed = false;
			for (const w of sourceWorkflows) {
				if (!reserved.has(w.id) || w.id === "simple" || mappings[w.id])
					continue;
				const calls = (steps: WorkflowStep[]): boolean =>
					steps.some(
						(step) =>
							(!!step.workflow && !!mappings[step.workflow]) ||
							(step.groups ?? []).some(calls),
					);
				if (calls(w.steps)) {
					const target = `legacy-${w.id}-${hash.slice(0, 10)}`;
					if (occupied.has(target))
						throw new Error(`Migration identity collision: ${target}`);
					occupied.add(target);
					mappings[w.id] = target;
					changed = true;
				}
			}
		}
		// A customized root owns private copies of the entire dependency graph.
		for (const w of sourceWorkflows.filter((w) => mappings[w.id])) {
			const privateIds: Record<string, string> = { [w.id]: mappings[w.id]! };
			const reachable = closure(w, [
				...defaultWorkflows.filter(
					(stock) => !sourceWorkflows.some((old) => old.id === stock.id),
				),
				...sourceWorkflows,
			]);
			for (const child of reachable)
				if (child.id !== w.id) {
					const target = `${mappings[w.id]}-${digest(child.id).slice(0, 8)}`;
					if (occupied.has(target))
						throw new Error(
							`Migration dependency identity collision: ${target}`,
						);
					occupied.add(target);
					privateIds[child.id] = target;
				}
			for (const child of reachable) {
				const copy = normalizeLegacy(child);
				copy.id = privateIds[child.id]!;
				copy.name = `Legacy ${child.name}`;
				if (child.id !== w.id) {
					copy.labels = [];
					copy.internal = true;
					copy.allowedTriggers = ["workflow"];
				}
				rewrite(copy.steps, privateIds);
				result.locals.push(copy);
				result.provenance[copy.id] = {
					source: child.id,
					digest: hash,
					dependencies: privateIds,
					kind: "migration",
				};
			}
		}
		for (const w of sourceWorkflows) {
			if (reserved.has(w.id)) {
				if (mappings[w.id]) continue;
				if (conflicts[w.id]) {
					result.launch[w.id] = {
						labels: w.labels,
						allowedTriggers: w.allowedTriggers.filter((t) => t !== "workflow"),
					};
					continue;
				}
				result.launch[w.id] = {
					labels: w.labels,
					allowedTriggers: w.allowedTriggers,
				};
				const owner =
					w.id === "factory" && !w.steps.some((s) => s.type === "workflow")
						? "factory-pipeline"
						: w.id;
				result.preferences[owner] = {
					...(result.preferences[owner] ?? {}),
					...extract(w),
				};
			} else {
				const copy = normalizeLegacy(w);
				rewrite(copy.steps, mappings);
				result.locals.push(copy);
			}
		}
		const specialists = workflowRoles(
			reserved.get("factory-pipeline")!.steps,
		).filter(({ role }) => role.startsWith("specialist-review/"));
		for (const [owner, prefs] of Object.entries(result.preferences)) {
			const old = prefs["code-review"];
			if (old && ["factory", "factory-pipeline"].includes(owner)) {
				for (const { role } of specialists)
					prefs[role] ??= structuredClone(old);
				delete prefs["code-review"];
			}
			const roles = new Set(
				workflowRoles(reserved.get(owner)!.steps).map((r) => r.role),
			);
			for (const [role, settings] of Object.entries(prefs))
				if (!roles.has(role)) {
					result.inactive.push({
						workflow: owner,
						role,
						settings,
						reason: "Role is absent from the installed standard",
					});
					delete prefs[role];
				}
		}
		const savedDefault = Array.isArray(document)
			? "simple"
			: (document.defaultWorkflow ?? "simple");
		result.defaultWorkflow = mappings[savedDefault] ?? savedDefault;
		result.order = [
			...sourceWorkflows.map((w) => mappings[w.id] ?? w.id),
			...result.locals.map((w) => w.id),
			...reserved.keys(),
		].filter((id, index, all) => all.indexOf(id) === index);
		result.migration = {
			digest: hash,
			backup: `${this.path}.backup-${hash}`,
			mappings,
			conflicts,
		};
		this.reconcile(result);
		return result;
	}
	private reconcile(state: WorkflowConfiguration) {
		for (const [owner, prefs] of Object.entries(state.preferences)) {
			const roles = new Map(
				workflowRoles(reserved.get(owner)?.steps ?? []).map((item) => [
					item.role,
					item.step,
				]),
			);
			for (const [role, settings] of Object.entries(prefs)) {
				let reason =
					roles.has(role) || (owner === "simple" && role === "native")
						? undefined
						: "Role is absent from the installed standard";
				try {
					if (settings.runner) resolveAgentSettings(settings.runner, settings);
				} catch (error) {
					reason = String(error);
				}
				if (reason) {
					state.inactive.push({ workflow: owner, role, settings, reason });
					delete prefs[role];
				}
			}
		}
	}
	private resolve(state: WorkflowConfiguration): Workflow[] {
		const definitions = [
			...structuredClone(defaultWorkflows),
			...structuredClone(state.locals),
		];
		for (const w of definitions) {
			if (reserved.has(w.id)) {
				Object.assign(w, state.launch[w.id] ?? {});
				const roles = workflowRoles(w.steps);
				for (const { role, step } of roles)
					Object.assign(step, state.preferences[w.id]?.[role] ?? {});
			}
		}
		return definitions.sort(
			(a, b) =>
				(state.order.indexOf(a.id) < 0 ? 999 : state.order.indexOf(a.id)) -
				(state.order.indexOf(b.id) < 0 ? 999 : state.order.indexOf(b.id)),
		);
	}
	private validate(state: WorkflowConfiguration) {
		for (const w of state.locals)
			if (reserved.has(w.id))
				throw new Error(`Bundled workflow identity is reserved: ${w.id}`);
		for (const key of Object.keys(state.preferences))
			if (!reserved.has(key))
				throw new Error(`Unknown bundled preferences: ${key}`);
		const all = this.resolve(state);
		const ids = new Set(all.map((w) => w.id));
		for (const key of [
			...Object.keys(state.launch),
			...Object.keys(state.enabled),
		])
			if (!ids.has(key)) throw new Error(`Unknown workflow settings: ${key}`);
		for (const w of all) {
			if (["__proto__", "constructor", "prototype"].includes(w.id))
				throw new Error(`Reserved workflow settings identity: ${w.id}`);
			const roles = workflowRoles(w.steps).map((r) => r.role);
			if (new Set(roles).size !== roles.length)
				throw new Error(`Ambiguous semantic role identities in ${w.id}`);
		}

		// Structural validation deliberately does not reject disabled dependencies.
		validateWorkflows(all);
		if (!all.some((w) => w.id === state.defaultWorkflow))
			throw new Error(`Unknown default workflow: ${state.defaultWorkflow}`);
		for (const [owner, prefs] of Object.entries(state.preferences)) {
			const roles = new Set(
				workflowRoles(reserved.get(owner)!.steps).map((r) => r.role),
			);
			if (owner === "simple") roles.add("native");
			for (const [role, settings] of Object.entries(prefs)) {
				if (!roles.has(role))
					throw new Error(`Unknown execution role: ${owner}/${role}`);
				if (settings.runner) resolveAgentSettings(settings.runner, settings);
			}
		}
	}
	read(): WorkflowConfiguration {
		return structuredClone(this.state);
	}
	list(): Workflow[] {
		return this.resolve(this.state);
	}
	defaultWorkflow(): string {
		return this.state.defaultWorkflow;
	}
	metadata(id: string) {
		const w = this.list().find((w) => w.id === id)!;
		const unavailable = this.unavailable(w, this.list());
		return {
			ownership: reserved.has(id) ? "bundled" : "local",
			enabled: this.state.enabled[id] !== false,
			provenance: this.state.provenance[id],
			unavailable,
		};
	}
	policyGraph(
		root: Workflow,
		definitions: Workflow[],
	): { root: Workflow; definitions: Workflow[] } {
		const receipt = this.state.migration;
		if (!receipt?.mappings[root.id] || !existsSync(receipt.backup))
			return { root, definitions };
		const source = JSON.parse(readFileSync(receipt.backup, "utf8"));
		const originals = (Array.isArray(source) ? source : source.workflows).map(
			(w: unknown) => WorkflowSchema.parse(w),
		) as Workflow[];
		const accepted = closure(root, definitions);
		if (
			!accepted.every((w) => {
				const original = originals.find((old) => old.id === w.id);
				return original && isDeepStrictEqual(behavior(w), behavior(original));
			})
		)
			return { root, definitions };
		const target = receipt.mappings[root.id]!;
		const mapping = this.state.provenance[target]?.dependencies;
		if (!mapping) return { root, definitions };
		const copy = (w: Workflow) => {
			const result = structuredClone(w);
			result.id = mapping[w.id] ?? w.id;
			rewrite(result.steps, mapping);
			return result;
		};
		return { root: copy(root), definitions: definitions.map(copy) };
	}
	unavailable(root: Workflow, definitions: Workflow[]): string[] {
		const policy = this.policyGraph(root, definitions);
		return closure(policy.root, policy.definitions)
			.filter(
				(w) =>
					this.state.enabled[w.id] === false ||
					this.state.migration?.conflicts[w.id],
			)
			.map((w) => w.id);
	}
	resolveSimpleConflict() {
		const next = structuredClone(this.state);
		if (!next.migration?.conflicts.simple)
			throw new Error("Simple has no migration conflict");
		delete next.migration.conflicts.simple;
		this.commit(next);
	}
	requireAvailable(
		root: Workflow,
		definitions: Workflow[],
		executionId?: string,
	) {
		const block = executionId ? this.blocks[executionId] : undefined;
		if (block) throw new Error(block.reason);
		const disabled = this.unavailable(root, definitions);
		if (disabled.length)
			throw new Error(
				`Workflow ${root.id} is unavailable: ${disabled.join(", ")}. Enable the workflow or resolve its migration conflict in Recipes. Existing blocked work needs individual Resume.`,
			);
	}
	block(id: string, block: WorkflowBlock) {
		if (!Object.hasOwn(this.blocks, id))
			Object.defineProperty(this.blocks, id, {
				value: structuredClone(block),
				enumerable: true,
				configurable: true,
				writable: true,
			});
		atomic(this.blocksPath, this.blocks);
	}
	getBlock(id: string): WorkflowBlock | undefined {
		return Object.hasOwn(this.blocks, id)
			? structuredClone(this.blocks[id])
			: undefined;
	}
	clearBlock(id: string) {
		delete this.blocks[id];
		atomic(this.blocksPath, this.blocks);
	}
	save(
		value: unknown,
		defaultWorkflow = this.state.defaultWorkflow,
	): Workflow[] {
		const proposed = validateWorkflows(value);
		const next = structuredClone(this.state);
		next.locals = [];
		next.defaultWorkflow = defaultWorkflow;
		next.order = proposed.map((w) => w.id);
		for (const w of proposed) {
			const stock = reserved.get(w.id);
			if (stock) {
				// The dashboard resolves inherited launch fields for rendering. Accept only
				// that exact generated view; changed fields remain a behavior edit.
				if (
					w.launchFields &&
					isDeepStrictEqual(w.launchFields, getLaunchFields(stock))
				) {
					if (stock.launchFields === undefined) delete w.launchFields;
					else w.launchFields = stock.launchFields;
				}
				if (!isDeepStrictEqual(behavior(w), behavior(stock)))
					throw new Error(
						`Bundled workflow ${w.id} is read-only. Edit execution preferences or fork Factory/Takeover.`,
					);
				next.preferences[w.id] = extract(w);
				// Native Simple has no graph; its preferences use the dedicated API.
				if (w.id === "simple")
					next.preferences[w.id] = this.state.preferences[w.id] ?? {};
				next.launch[w.id] = {
					labels: w.labels,
					allowedTriggers: w.allowedTriggers,
				};
			} else next.locals.push(w);
		}
		this.commit(next);
		return this.list();
	}
	savePreferences(id: string, prefs: unknown) {
		if (!reserved.has(id))
			throw new Error(
				"Local workflows own their agent settings in their editable graph",
			);
		const next = structuredClone(this.state);
		next.preferences[id] = preference.parse(prefs);
		this.commit(next);
	}
	updateInactive(index: number, target?: { workflow: string; role: string }) {
		const next = structuredClone(this.state),
			item = next.inactive[index];
		if (!item) throw new Error("Inactive preference not found");
		if (target) {
			const owner = reserved.get(target.workflow);
			if (
				!owner ||
				!(
					workflowRoles(owner.steps).some((r) => r.role === target.role) ||
					(target.workflow === "simple" && target.role === "native")
				)
			)
				throw new Error("Choose a current bundled workflow and role");
			next.preferences[target.workflow] ??= {};
			next.preferences[target.workflow]![target.role] = item.settings;
		}
		next.inactive.splice(index, 1);
		this.commit(next);
	}
	setEnabled(id: string, enabled: boolean) {
		if (!this.list().some((w) => w.id === id))
			throw new Error(`Unknown workflow: ${id}`);
		const next = structuredClone(this.state);
		next.enabled[id] = enabled;
		this.commit(next);
	}
	private commit(value: WorkflowConfiguration) {
		const next = envelopeSchema.parse(value);
		this.validate(next);
		atomic(this.path, next);
		this.state = next;
	}
	fork(id: string, name?: string): Workflow {
		if (id === "simple") throw new Error("Simple cannot be forked");
		const root = this.list().find((w) => w.id === id);
		if (!root || !["factory", "takeover"].includes(id))
			throw new Error("Fork a bundled Factory or Takeover workflow");
		const reachable = closure(root, this.list());
		const mappings = Object.fromEntries(
			reachable.map((w) => [w.id, `fork-${randomUUID()}`]),
		);
		const next = structuredClone(this.state);
		for (const w of reachable) {
			const copy = structuredClone(w);
			copy.id = mappings[w.id]!;
			copy.name =
				w.id === id ? (name ?? `${w.name} fork`) : `${w.name} (private)`;
			copy.labels = [];
			if (w.id !== id) {
				copy.internal = true;
				copy.allowedTriggers = ["workflow"];
			}
			rewrite(copy.steps, mappings);
			next.locals.push(copy);
			next.order.push(copy.id);
			next.provenance[copy.id] = {
				source: w.id,
				version: factoryRuntimeIdentity.version,
				digest: digest(behavior(reserved.get(w.id) ?? w)),
				dependencies: mappings,
				kind: "fork",
			};
		}
		this.commit(next);
		return this.list().find((w) => w.id === mappings[id])!;
	}
	validateImport(value: unknown): WorkflowConfiguration {
		const next = envelopeSchema.parse(value);
		for (const [id, record] of Object.entries(next.provenance)) {
			if (record.source === "simple")
				throw new Error(
					"Simple cannot be forked or imported under another native identity",
				);
			if (!next.locals.some((w) => w.id === id))
				throw new Error(`Unknown provenance workflow: ${id}`);
		}
		// Migration decisions and run identity mappings are host-owned, never imported.
		next.migration = this.state.migration;
		this.validate(next);
		return next;
	}
	import(value: unknown) {
		this.commit(this.validateImport(value));
	}
	simplePreferences(): AgentSettings {
		return structuredClone(this.state.preferences.simple?.native ?? {});
	}
}
