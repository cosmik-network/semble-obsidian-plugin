import { describe, expect, it } from "vitest";
import { hostOf, isHttpUrl, sameUrl, sembleCollectionUrl, sembleProfileUrl } from "../src/urls";

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

	it("builds Semble profile and collection links", () => {
		expect(sembleProfileUrl("wesleyfinck.org")).toBe("https://semble.so/profile/wesleyfinck.org");
		expect(
			sembleCollectionUrl("hoagecko.bsky.social", "at://did:plc:abc123/network.cosmik.collection/3mubyr26m6h2d"),
		).toBe("https://semble.so/profile/hoagecko.bsky.social/collections/3mubyr26m6h2d");
		expect(sembleCollectionUrl("a.dev", undefined)).toBeNull();
		expect(sembleCollectionUrl("a.dev", "not-an-at-uri")).toBeNull();
	});
});
