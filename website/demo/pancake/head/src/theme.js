// Applied before first paint so returning night owls never see a light flash.
const KEY = "pancake-theme";
const stored = localStorage.getItem(KEY);
const system = matchMedia("(prefers-color-scheme: dark)");
const apply = (theme) => {
	document.documentElement.dataset.theme = theme;
	const button = document.querySelector("[data-theme-toggle]");
	if (!button) return;
	button.textContent = theme === "dark" ? "☀️" : "🌙";
	button.setAttribute(
		"aria-label",
		`Switch to ${theme === "dark" ? "light" : "dark"} mode`,
	);
};
apply(stored ?? (system.matches ? "dark" : "light"));
system.addEventListener("change", (event) => {
	if (!localStorage.getItem(KEY)) apply(event.matches ? "dark" : "light");
});
addEventListener("DOMContentLoaded", () => {
	apply(document.documentElement.dataset.theme);
	document
		.querySelector("[data-theme-toggle]")
		?.addEventListener("click", () => {
			const next =
				document.documentElement.dataset.theme === "dark" ? "light" : "dark";
			localStorage.setItem(KEY, next);
			apply(next);
		});
});
