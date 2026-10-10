import { useAction } from "./client";
import { useFormState } from "./form-state";
import { Button } from "./ui";

export function ExternalRecovery({ run }: { run: any }) {
	const [form, setForm] = useFormState(`${run.id}/${run.updatedAt}`, {
		contract: "",
		reviewed: false,
		error: "",
	});
	const action = useAction();
	if (
		run.status !== "failed" ||
		!/(^|\/)draft-pr$/.test(run.step ?? "") ||
		run.deliveryRecovery
	)
		return null;
	async function recover() {
		try {
			const contract = JSON.parse(form.contract);
			const canonical = (v: any): any =>
				Array.isArray(v)
					? v.map(canonical)
					: v && typeof v === "object"
						? Object.fromEntries(
								Object.entries(v)
									.sort(([a], [b]) => a.localeCompare(b))
									.map(([k, x]) => [k, canonical(x)]),
							)
						: v;
			const bytes = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(JSON.stringify(canonical(contract))),
			);
			const reviewedDigest = [...new Uint8Array(bytes)]
				.map((v) => v.toString(16).padStart(2, "0"))
				.join("");
			await action.mutateAsync({
				path: `/api/runs/${run.id}/external-recovery`,
				body: { requestId: crypto.randomUUID(), contract, reviewedDigest },
			});
		} catch (error) {
			setForm((f) => ({ ...f, error: String(error) }));
		}
	}
	return (
		<details className="notice">
			<summary>Recover already-applied external ticket work</summary>
			<p>
				Recovery reads and verifies existing ticket changes before a new human
				review. It keeps the original failed publication and conversation
				history. It does not replay the original edits.
			</p>
			<p>
				Supply a reviewed delivery-v1 external contract with verified ticket
				identities, authorization, before-state, expected outcomes and the
				retained execution reference.{" "}
				<a
					href="https://github.com/JappyJan/bobs-factory/blob/main/docs/factory/external-delivery.md"
					target="_blank"
					rel="noreferrer"
				>
					Recovery procedure ↗
				</a>
			</p>
			<label>
				Reviewed external delivery contract
				<textarea
					value={form.contract}
					onChange={(e) =>
						setForm((f) => ({
							...f,
							contract: e.target.value,
							reviewed: false,
							error: "",
						}))
					}
					rows={10}
				/>
			</label>
			<label>
				<input
					type="checkbox"
					checked={form.reviewed}
					onChange={(e) =>
						setForm((f) => ({ ...f, reviewed: e.target.checked }))
					}
				/>{" "}
				I reviewed this contract and its execution authorization.
			</label>
			{form.error && <p role="alert">{form.error}</p>}
			<Button
				requiresConnection
				busy={action.isPending}
				disabled={!form.reviewed || !form.contract.trim()}
				onClick={() => void recover()}
			>
				Verify existing work for external review
			</Button>
		</details>
	);
}
