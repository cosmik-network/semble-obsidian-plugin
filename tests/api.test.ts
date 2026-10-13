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

	it("caches the profile until reset", async () => {
		requestUrl.mockResolvedValue(ok({ id: "u1", name: "U", handle: "u.bsky.social" }));
		const client = new SembleClient(() => "k");
		await client.getMyProfile();
		await client.getMyProfile();
		expect(requestUrl).toHaveBeenCalledTimes(1);
		client.reset();
		await client.getMyProfile();
		expect(requestUrl).toHaveBeenCalledTimes(2);
	});
});
