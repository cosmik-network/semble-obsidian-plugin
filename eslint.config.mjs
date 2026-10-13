// @ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores(["main.js", "node_modules/", "*.mjs"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// "Semble" is a product name, not a word to lowercase.
			"obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["Semble"] }],
		},
	},
]);
