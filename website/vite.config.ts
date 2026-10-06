import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves the project site under /bobs-factory/; override with SITE_BASE.
export default defineConfig({
	base: process.env.SITE_BASE ?? "/",
	plugins: [react(), tailwindcss()],
	server: { port: 5180 },
});
