import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.fn();
vi.mock("obsidian", () => ({ requestUrl }));

const { SembleApiError, SembleClient } = await import("../src/api");

const ok = (json: unknown) => ({ status: 200, json, text: JSON.stringify(json) });

describe("SembleClient", () => {
	beforeEach(() => requestUrl.mockReset());

	it("sends GET requests with query params, API key and client headers", async () => {
		requestUrl.mockResolvedValue(ok({ metadata: { url: "https://a.dev" } }));
		await new SembleClient(() => "key-123").getUrlInfo("https://a.dev/x?y=1");

		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "https://api.semble.so/xrpc/network.cosmik.card.getUrlMetadata?url=https%3A%2F%2Fa.dev%2Fx%3Fy%3D1&includeStats=true",
				headers: { "x-api-key": "key-123", "X-Semble-Client": "obsidian" },
				throw: false,
			}),
		);
	});

	it("omits undefined query params", async () => {
		requestUrl.mockResolvedValue(ok({ collections: [] }));
		await new SembleClient(() => "k").listMyCollections("");
		const { url } = requestUrl.mock.calls[0]![0] as { url: string };
		expect(url).not.toContain("searchText");
	});

	it("posts JSON bodies", async () => {
		requestUrl.mockResolvedValue(ok({ connectionId: "c1" }));
		await new SembleClient(() => "k").createConnection({
			sourceUrl: "https://a.dev",
			targetUrl: "https://b.dev",
			connectionType: "SUPPORTS",
		});
		const params = requestUrl.mock.calls[0]![0] as { method: string; body: string; contentType: string };
		expect(params.method).toBe("POST");
		expect(params.contentType).toBe("application/json");
		expect(JSON.parse(params.body)).toEqual({
			sourceType: "URL",
			sourceValue: "https://a.dev",
			targetType: "URL",
			targetValue: "https://b.dev",
			connectionType: "SUPPORTS",
		});
	});

	it("fails fast without an API key", async () => {
		await expect(new SembleClient(() => null).getMyProfile()).rejects.toBeInstanceOf(SembleApiError);
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it("explains auth failures and surfaces API error messages", async () => {
		const client = new SembleClient(() => "k");
		requestUrl.mockResolvedValueOnce({ status: 401, json: {}, text: "" });
		await expect(client.getUrlInfo("https://a.dev")).rejects.toThrow(/rejected the API key/);

		requestUrl.mockResolvedValueOnce({ status: 400, json: { message: "Invalid URL" }, text: "" });
		await expect(client.getUrlInfo("nope")).rejects.toThrow("Invalid URL");
	});

	it("treats a 404 library status as not in library", async () => {
		requestUrl.mockResolvedValue({ status: 404, json: {}, text: "" });
		await expect(new SembleClient(() => "k").getLibraryStatus("https://a.dev")).resolves.toEqual({});
	});
});

describe("SembleClient cache", () => {
	beforeEach(() => requestUrl.mockReset());

	const info = (url: string) => ok({ metadata: { url } });

	it("reuses GET responses and shares in-flight requests", async () => {
		requestUrl.mockResolvedValue(info("https://a.dev"));
		const client = new SembleClient(() => "k");
		await Promise.all([client.getUrlInfo("https://a.dev"), client.getUrlInfo("https://a.dev")]);
		await client.getUrlInfo("https://a.dev");
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it("does not cache failures", async () => {
		requestUrl.mockResolvedValueOnce({ status: 500, json: {}, text: "" }).mockResolvedValue(info("https://a.dev"));
		const client = new SembleClient(() => "k");
		await expect(client.getUrlInfo("https://a.dev")).rejects.toThrow();
		await expect(client.getUrlInfo("https://a.dev")).resolves.toBeTruthy();
		expect(requestUrl).toHaveBeenCalledTimes(2);
	});

	it("expires entries after the TTL", async () => {
		vi.useFakeTimers();
		try {
			requestUrl.mockResolvedValue(info("https://a.dev"));
			const client = new SembleClient(() => "k");
			await client.getUrlInfo("https://a.dev");
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			await client.getUrlInfo("https://a.dev");
			expect(requestUrl).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("invalidates a URL's entries after a mutation, matching normalized URLs", async () => {
		requestUrl.mockResolvedValue(info("https://a.dev/"));
		const client = new SembleClient(() => "k");
		await client.getUrlInfo("https://a.dev");
		await client.getUrlInfo("https://b.dev");
		expect(requestUrl).toHaveBeenCalledTimes(2);

		// Semble reports the connection's ends in normalized form.
		await client.deleteConnection("c1", ["https://a.dev/", "https://c.dev/"]);
		await client.getUrlInfo("https://a.dev"); // refetched
		await client.getUrlInfo("https://b.dev"); // still cached
		expect(requestUrl).toHaveBeenCalledTimes(4);
	});

	it("drops collection lists when a collection is created", async () => {
		requestUrl.mockResolvedValue(ok({ collections: [], collectionId: "x" }));
		const client = new SembleClient(() => "k");
		await client.listMyCollections();
		await client.createCollection("New");
		await client.listMyCollections();
		expect(requestUrl).toHaveBeenCalledTimes(3);
	});

	it("starts over when the API key changes", async () => {
		requestUrl.mockResolvedValue(ok({ id: "u1", name: "U", handle: "u.bsky.social" }));
		let key = "first";
		const client = new SembleClient(() => key);
		await client.getMyProfile();
		key = "second";
		await client.getMyProfile();
		expect(requestUrl).toHaveBeenCalledTimes(2);
	});
});
