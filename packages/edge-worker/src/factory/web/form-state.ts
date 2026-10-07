import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

/** Local edits belong to one mounted form and one content context. */
export function useFormState<T>(
	context: string,
	initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
	const fresh = () =>
		typeof initial === "function" ? (initial as () => T)() : initial;
	const [state, setState] = useState(() => ({
		context,
		value: fresh(),
		generation: {},
	}));
	let current = state;
	if (state.context !== context) {
		current = { context, value: fresh(), generation: {} };
		setState(current);
	}
	const active = useRef(current.generation);
	active.current = current.generation;
	const generation = current.generation;
	const set: Dispatch<SetStateAction<T>> = useCallback(
		(next) => {
			// A delayed callback from an earlier context must not clear replacement edits.
			if (active.current !== generation) return;
			setState((previous) =>
				active.current !== generation
					? previous
					: {
							...previous,
							value:
								typeof next === "function"
									? (next as (v: T) => T)(previous.value)
									: next,
						},
			);
		},
		[generation],
	);
	return [current.value, set];
}

/** Delayed side effects must still belong to the current mounted form. */
export function useCurrentForm(context: string) {
	const [identity] = useFormState(context, () => ({}));
	const active = useRef(identity);
	active.current = identity;
	useEffect(() => {
		active.current = identity;
		return () => {
			active.current = {};
		};
	}, [identity]);
	return () => active.current === identity;
}
