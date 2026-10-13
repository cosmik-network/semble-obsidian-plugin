import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ Modal: class {}, Setting: class {}, setIcon: () => {} }));

const { hostOf, isHttpUrl, sameUrl } = await import("../src/ui");

describe("url helpers", () => {
	it("treats Semble-normalized URLs as the same", () => {
		expect(sameUrl("https://semble.so", "https://semble.so/")).toBe(true);
		expect(sameUrl("https://Example.com/a/", "https://example.com/a")).toBe(true);
		expect(sameUrl("https://a.dev/x?q=1", "https://a.dev/x?q=2")).toBe(false);
		expect(sameUrl("https://a.dev/x", "https://a.dev/y")).toBe(false);
	});

	it("validates http(s) URLs only", () => {
		expect(isHttpUrl("https://a.dev")).toBe(true);
		expect(isHttpUrl("mailto:a@b.dev")).toBe(false);
		expect(isHttpUrl("not a url")).toBe(false);
	});

	it("shows hosts without www", () => {
		expect(hostOf("https://www.example.com/page")).toBe("example.com");
		expect(hostOf("nope")).toBeNull();
	});
});
