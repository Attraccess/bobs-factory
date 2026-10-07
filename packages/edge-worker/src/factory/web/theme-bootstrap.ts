import { applyTheme, readThemeChoice, resolveTheme, themeQuery } from "./theme";

// Runs before CSS or the app bundle, including when opening a cached shell.
applyTheme(resolveTheme(readThemeChoice(), matchMedia(themeQuery).matches));
