import { useEffect } from "react";
/** Keep programmatic heading focus; show its ring only for keyboard navigation. */
export function useReviewInput() {
	useEffect(() => {
		const pointer = () => {
			document.documentElement.dataset.reviewInput = "pointer";
		};
		const keyboard = () => {
			document.documentElement.dataset.reviewInput = "keyboard";
		};
		document.documentElement.dataset.reviewInput ??= "pointer";
		window.addEventListener("pointerdown", pointer, true);
		window.addEventListener("keydown", keyboard, true);
		return () => {
			window.removeEventListener("pointerdown", pointer, true);
			window.removeEventListener("keydown", keyboard, true);
		};
	}, []);
}
