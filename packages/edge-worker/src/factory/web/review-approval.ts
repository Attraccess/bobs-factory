import { useAction } from "./client";
import type { FeedbackController } from "./review-comments";
import { guideMatchesGate } from "./review-state";
import { useToast } from "./ui";

/** The single approval path, shared by the decision page and the brief's decision panel. */
export function useApproval(run: any, controller: FeedbackController) {
	const toast = useToast(),
		action = useAction(`review/${run.id}`, controller.context),
		gate = run.reviewGate,
		waiting = gate?.status === "pending",
		matching = !waiting || (run.status === "waiting" && guideMatchesGate(run));
	const approve = () => {
		if (!waiting || !matching || action.isPending || !controller.lock()) return;
		void action
			.mutateAsync({
				path: `/api/runs/${run.id}/review`,
				body: {
					reviewId: gate.id,
					headSha: gate.headSha,
					externalDigest: gate.externalDigest,
					decision: "approve",
				},
			})
			.then(() =>
				toast({
					text:
						gate.mode === "external"
							? "Accepted — Bob is checking the current ticket state"
							: "Approved — Bob is checking merge criteria",
				}),
			)
			.catch(() => {})
			.finally(() => controller.unlock());
	};
	return { action, approve, waiting, matching };
}
