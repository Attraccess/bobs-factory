import { useLayoutEffect } from "react";
import { readStored, writeStored } from "./review-state";

/** Document coordinates only; the artifact inspector has its own scroll container. */
export function useReadingPosition(key?: string, restoreSaved = true) {
	useLayoutEffect(() => {
		if (!key) return;
		const saved = readStored<unknown>(key, 0),
			y =
				typeof saved === "number" && Number.isFinite(saved) && saved >= 0
					? saved
					: 0;
		let restoring = restoreSaved;
		const restore = () => {
			if (restoring) window.scrollTo({ top: y, behavior: "instant" });
		};
		const save = () => {
			if (!restoring) writeStored(key, window.scrollY);
		};
		const finish = () => {
			restoring = false;
			observer.disconnect();
		};
		// The saved chapter mounts before this effect. Lazy images and drafts may
		// increase its height afterwards; stop restoring as soon as the user acts.
		const observer = new ResizeObserver(restore);
		if (restoring) observer.observe(document.body);
		restore();
		const timer = window.setTimeout(finish, 3000);
		window.addEventListener("scroll", save, { passive: true });
		for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
			window.addEventListener(event, finish, { passive: true });
		return () => {
			clearTimeout(timer);
			observer.disconnect();
			window.removeEventListener("scroll", save);
			for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
				window.removeEventListener(event, finish);
			// An explicit chapter change saves the old chapter before focusing the new one.
			writeStored(key, restoring ? y : window.scrollY);
		};
	}, [key, restoreSaved]);
}
