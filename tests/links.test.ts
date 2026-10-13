import type { CachedMetadata } from "obsidian";
import { describe, expect, it } from "vitest";
import { extractLinks, trimTrailingPunctuation } from "../src/links";

const urls = (content: string, cache: CachedMetadata | null = null) =>
	extractLinks(content, cache).map((link) => link.url);

const pos = (start: number, end: number) => ({
	start: { line: 0, col: start, offset: start },
	end: { line: 0, col: end, offset: end },
});

describe("extractLinks", () => {
	it("finds markdown links, autolinks and bare URLs in document order", () => {
		const content = "See [docs](https://a.dev/docs), <https://b.dev> and http://c.dev/x.";
		expect(urls(content)).toEqual(["https://a.dev/docs", "https://b.dev", "http://c.dev/x"]);
	});

	it("uses anchor text as display text and falls back to the URL", () => {
		const [named, bare] = extractLinks("[Semble](https://semble.so) https://x.dev", null);
		expect(named?.displayText).toBe("Semble");
		expect(bare?.displayText).toBe("https://x.dev");
	});

	it("marks remote images", () => {
		const [link] = extractLinks("![alt](https://img.dev/a.png)", null);
		expect(link).toMatchObject({ image: true, url: "https://img.dev/a.png" });
	});

	it("keeps balanced parentheses and angle-bracket destinations", () => {
		expect(urls("[x](https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
		expect(urls("[x](<https://a.dev/with space>)")).toEqual(["https://a.dev/with space"]);
		expect(urls("(see https://a.dev/page)")).toEqual(["https://a.dev/page"]);
	});

	it("ignores internal links and non-http schemes", () => {
		expect(urls("[note](Some%20Note.md) [[Other]] [mail](mailto:a@b.dev) <obsidian://open?vault=x>")).toEqual([]);
	});

	it("ignores URLs used as text inside internal links", () => {
		const content = "[[Note|https://alias.dev]]";
		const cache: CachedMetadata = {
			links: [{ link: "Note", original: content, displayText: "https://alias.dev", position: pos(0, content.length) }],
		};
		expect(urls(content, cache)).toEqual([]);
		expect(urls("[https://text.dev](Note.md)")).toEqual([]);
	});

	it("skips code blocks, inline code and frontmatter", () => {
		const content = [
			"---",
			"source: https://frontmatter.dev",
			"---",
			"`https://inline.dev`",
			"```",
			"https://fenced.dev",
			"```",
			"https://real.dev",
		].join("\n");
		expect(urls(content)).toEqual(["https://real.dev"]);
	});

	it("records zero-based line and column", () => {
		const [link] = extractLinks("first\n  https://a.dev", null);
		expect(link?.position.start).toEqual({ line: 1, col: 2, offset: 8 });
		expect(link?.position.end.offset).toBe(21);
	});
});

describe("helpers", () => {
	it("trims sentence punctuation after bare URLs", () => {
		expect(trimTrailingPunctuation("https://a.dev/x.")).toBe("https://a.dev/x");
		expect(trimTrailingPunctuation("https://a.dev/x),")).toBe("https://a.dev/x");
		expect(trimTrailingPunctuation("https://a.dev/Foo_(bar)")).toBe("https://a.dev/Foo_(bar)");
	});
});
