export type ThemeChoice = "light" | "dark" | "system";
export type AppTheme = Exclude<ThemeChoice, "system">;

export const themeColors = { light: "#fffaf3", dark: "#16122a" };
export const themeQuery = "(prefers-color-scheme: dark)";

export function themeChoice(value: unknown): ThemeChoice {
	return value === "light" || value === "dark" ? value : "system";
}

export function readThemeChoice(): ThemeChoice {
	try {
		return themeChoice(localStorage.getItem("factory-theme"));
	} catch {
		return "system";
	}
}

export function resolveTheme(
	choice: ThemeChoice,
	systemDark: boolean,
): AppTheme {
	return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

/** Shared by the blocking head bootstrap and React's live theme updates. */
export function applyTheme(theme: AppTheme) {
	const root = document.documentElement;
	root.dataset.theme = theme;
	root.style.colorScheme = theme;
	root.style.backgroundColor = themeColors[theme];
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", themeColors[theme]);
}
