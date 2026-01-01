import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
	root: "website",
	resolve: {
		alias: {
			"@lib": resolve(__dirname, "./lib"),
		},
	},
	build: {
		target: "esnext",
		rollupOptions: {
			input: {
				index: resolve(__dirname, "./website/index.html"),
				canvas: resolve(__dirname, "./website/canvas.html"),
			},
		},
		modulePreload: {
			polyfill: false,
		},
		outDir: "../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
	},
});
