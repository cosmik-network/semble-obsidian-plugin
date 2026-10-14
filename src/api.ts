import { requestUrl } from "obsidian";
import { sameUrl } from "./urls";

/*
 * Minimal typed client for the parts of the Semble XRPC API the plugin uses.
 * Types cover only the fields we read; the API returns more.
 */

const BASE_URL = "https://api.semble.so/xrpc";
/** Identifies this integration to Semble via the optional X-Semble-Client header. */
const CLIENT_ID = "semble-obsidian-plugin";

/** A cached response older than this is checked again in the background when next used. */
const REVALIDATE_AFTER_MS = 10 * 1000;
/** A cached response older than this isn't shown at all; it's fetched again first. */
const MAX_AGE_MS = 60 * 60 * 1000;

export const COLLECTION_LISTS = [
	"network.cosmik.collection.listMine",
	"network.cosmik.collection.search",
	"network.cosmik.collection.getRecommendedForUrl",
];

export const API_KEYS_URL = "https://semble.so/settings/api-keys";

export const URL_TYPES = ["article", "link", "book", "research", "audio", "video", "social", "event", "software"] as const;
export type UrlType = (typeof URL_TYPES)[number];

export const CONNECTION_TYPES = [
	"RELATED",
	"SUPPORTS",
	"OPPOSES",
	"ADDRESSES",
	"HELPFUL",
	"LEADS_TO",
	"SUPPLEMENT",
	"EXPLAINER",
	"SAME_AS",
	"REFERENCES",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export interface UrlMetadata {
	url: string;
	title?: string;
	description?: string;
	author?: string;
	siteName?: string;
	imageUrl?: string;
	type?: string;
}

export interface User {
	id: string;
	name: string;
	handle: string;
	avatarUrl?: string;
}

export interface Collection {
	id: string;
	/** AT URI, e.g. at://did:plc:…/network.cosmik.collection/<rkey>. */
	uri?: string;
	name: string;
	description?: string;
	accessType?: "OPEN" | "CLOSED";
	cardCount: number;
	updatedAt?: string;
	author: User;
}

/** A user who saved a URL, with their card for it. */
export interface LibraryEntry {
	user: User;
	card: UrlCard;
}

export interface UrlCard {
	id: string;
	url: string;
	cardContent: UrlMetadata;
	note?: { id: string; text: string };
}

export interface UrlStats {
	libraryCount: number;
	noteCount: number;
	collectionCount: number;
	connections: { all: { total: number }; incoming: { total: number }; outgoing: { total: number } };
}

export interface UrlInfo {
	metadata: UrlMetadata;
	stats?: UrlStats;
	urlInLibrary?: boolean;
}

export interface LibraryStatus {
	card?: UrlCard;
	collections?: Collection[];
}

/** A URL as it appears in search results and connections. */
export interface UrlView {
	url: string;
	metadata: UrlMetadata;
	urlLibraryCount: number;
	urlInLibrary?: boolean;
}

export interface Connection {
	connection: {
		id: string;
		type?: string;
		note?: string;
		createdAt: string;
		curator: User;
	};
	source: UrlView;
	target: UrlView;
}

export interface Pagination {
	currentPage: number;
	totalPages?: number;
	totalCount?: number;
	hasMore: boolean;
	limit: number;
}

export class SembleApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "SembleApiError";
	}
}

type Query = Record<string, string | number | boolean | undefined>;

interface CacheEntry {
	method: string;
	/** The `url` query param, so entries about a URL can be invalidated together. */
	url?: string;
	fetchedAt: number;
	value: Promise<unknown>;
	/** The resolved response, once it arrives: for peek(), and to compare with fresh data. */
	result?: { value: unknown; json: string };
	revalidating?: boolean;
}

/** Which cached response changed after a background check. */
export interface CacheChange {
	method: string;
	url?: string;
}

/**
 * GET responses are cached in memory and served stale-while-revalidate: a
 * cached response is returned immediately, and if it's more than a few
 * seconds old it's fetched again in the background. If the fresh data
 * differs, the cache is updated and onChange listeners are told, so views can
 * redraw just the parts that changed; identical data changes nothing.
 * Caching the promise also shares identical requests that are in flight.
 * Mutations invalidate the entries they affect, and the whole cache is
 * dropped when the API key changes.
 */
export class SembleClient {
	private readonly cache = new Map<string, CacheEntry>();
	/** The key the cache was filled with. */
	private cacheKey: string | null = null;
	private readonly listeners = new Set<(change: CacheChange) => void>();

	/** `getApiKey` is read on every request so key changes apply immediately. */
	constructor(private readonly getApiKey: () => string | null) {}

	get hasApiKey(): boolean {
		return Boolean(this.getApiKey());
	}

	/** Called when a background check finds different data. Returns an unsubscribe function. */
	onChange(listener: (change: CacheChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Drop cached responses about any of `urls` (matched by their `url`
	 * param) and every cached response from `methods`.
	 */
	invalidate({ urls = [], methods = [] }: { urls?: string[]; methods?: string[] }): void {
		for (const [key, entry] of this.cache) {
			const aboutUrl = entry.url !== undefined && urls.some((url) => sameUrl(url, entry.url!));
			if (aboutUrl || methods.includes(entry.method)) this.cache.delete(key);
		}
	}

	// --- Account ---

	getMyProfile(): Promise<User> {
		return this.get("network.cosmik.actor.getMyProfile");
	}

	// --- URLs and library ---

	getUrlInfo(url: string): Promise<UrlInfo> {
		return this.get("network.cosmik.card.getUrlMetadata", { url, includeStats: true });
	}

	/** getUrlInfo's cached result, if it has already arrived; never makes a request. */
	peekUrlInfo(url: string): UrlInfo | undefined {
		return this.peek("network.cosmik.card.getUrlMetadata", { url, includeStats: true });
	}

	async getLibraryStatus(url: string): Promise<LibraryStatus> {
		try {
			return await this.get<LibraryStatus>("network.cosmik.card.getLibraryStatus", { url });
		} catch (err) {
			if (err instanceof SembleApiError && err.status === 404) return {};
			throw err;
		}
	}

	// Library changes affect this URL's stats and status, and collection card counts.

	addUrl(body: { url: string; note?: string; collectionIds?: string[] }): Promise<{ urlCardId: string }> {
		return this.post("network.cosmik.card.addUrl", body, { urls: [body.url], methods: COLLECTION_LISTS });
	}

	updateUrlAssociations(
		url: string,
		body: { cardId: string; note?: string; addToCollections?: string[]; removeFromCollections?: string[] },
	): Promise<unknown> {
		return this.post("network.cosmik.card.updateUrlAssociations", body, { urls: [url], methods: COLLECTION_LISTS });
	}

	removeFromLibrary(url: string, cardId: string): Promise<unknown> {
		return this.post("network.cosmik.card.removeFromLibrary", { cardId }, { urls: [url], methods: COLLECTION_LISTS });
	}

	getSimilarUrls(
		url: string,
		options: { urlType?: UrlType; page?: number; limit?: number } = {},
	): Promise<{ urls: UrlView[]; pagination: Pagination }> {
		return this.get("network.cosmik.search.getSimilarUrls", { url, ...options });
	}

	getLibrariesForUrl(url: string, page = 1): Promise<{ libraries: LibraryEntry[]; pagination: Pagination }> {
		return this.get("network.cosmik.card.getLibrariesForUrl", { url, page, limit: 30 });
	}

	// --- Collections ---

	getCollectionsForUrl(url: string, page = 1): Promise<{ collections: Collection[]; pagination: Pagination }> {
		return this.get("network.cosmik.collection.getForUrl", { url, page, limit: 20 });
	}

	listMyCollections(searchText?: string): Promise<{ collections: Collection[] }> {
		return this.get("network.cosmik.collection.listMine", {
			searchText: searchText || undefined,
			limit: 100,
			sortBy: "updatedAt",
			sortOrder: "desc",
		});
	}

	getRecommendedCollections(url: string): Promise<{ myCollections: Collection[]; openCollections: Collection[] }> {
		return this.get("network.cosmik.collection.getRecommendedForUrl", { url, limit: 20 });
	}

	searchOpenCollections(searchText?: string): Promise<{ collections: Collection[] }> {
		return this.get("network.cosmik.collection.search", {
			searchText: searchText || undefined,
			accessType: "OPEN",
			limit: 50,
		});
	}

	createCollection(name: string): Promise<{ collectionId: string }> {
		return this.post("network.cosmik.collection.create", { name }, { methods: COLLECTION_LISTS });
	}

	// --- Connections ---

	getConnections(url: string): Promise<{ connections: Connection[]; pagination: Pagination }> {
		return this.get("network.cosmik.connection.getForUrl", {
			url,
			direction: "both",
			limit: 50,
			sortBy: "createdAt",
			sortOrder: "desc",
		});
	}

	createConnection(body: {
		sourceUrl: string;
		targetUrl: string;
		connectionType: ConnectionType;
		note?: string;
	}): Promise<{ connectionId: string }> {
		return this.post(
			"network.cosmik.connection.create",
			{
				sourceType: "URL",
				sourceValue: body.sourceUrl,
				targetType: "URL",
				targetValue: body.targetUrl,
				connectionType: body.connectionType,
				note: body.note,
			},
			{ urls: [body.sourceUrl, body.targetUrl] },
		);
	}

	/** `urls` are the connection's two ends, whose cached connections and stats go stale. */
	deleteConnection(connectionId: string, urls: string[]): Promise<unknown> {
		return this.post("network.cosmik.connection.delete", { connectionId }, { urls });
	}

	// --- Transport ---

	private pathFor(method: string, query: Query): string {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) params.set(key, String(value));
		}
		const qs = params.toString();
		return `${method}${qs ? `?${qs}` : ""}`;
	}

	private checkCacheKey(): void {
		const apiKey = this.getApiKey();
		if (apiKey !== this.cacheKey) {
			// Different key, possibly a different account: nothing cached still applies.
			this.cache.clear();
			this.cacheKey = apiKey;
		}
	}

	/** A cached GET response that has already arrived, without making a request. */
	private peek<T>(method: string, query: Query): T | undefined {
		this.checkCacheKey();
		const entry = this.cache.get(this.pathFor(method, query));
		if (!entry || Date.now() - entry.fetchedAt > MAX_AGE_MS) return undefined;
		return entry.result?.value as T | undefined;
	}

	private get<T>(method: string, query: Query = {}): Promise<T> {
		const path = this.pathFor(method, query);
		this.checkCacheKey();

		const now = Date.now();
		const hit = this.cache.get(path);
		if (hit && now - hit.fetchedAt <= MAX_AGE_MS) {
			if (hit.result && now - hit.fetchedAt > REVALIDATE_AFTER_MS) void this.revalidate(path, hit);
			return hit.value as Promise<T>;
		}

		const value = this.request<T>("GET", path);
		const entry: CacheEntry = {
			method,
			url: typeof query.url === "string" ? query.url : undefined,
			fetchedAt: now,
			value,
		};
		this.cache.set(path, entry);
		value.then(
			(result) => (entry.result = { value: result, json: JSON.stringify(result) }),
			// Never cache failures; the caller still sees the rejection.
			() => {
				if (this.cache.get(path) === entry) this.cache.delete(path);
			},
		);
		return value;
	}

	/** Fetch a cached response again; update it and notify listeners only if the data changed. */
	private async revalidate(path: string, entry: CacheEntry): Promise<void> {
		if (entry.revalidating) return;
		entry.revalidating = true;
		try {
			const fresh = await this.request("GET", path);
			// Invalidated, or replaced by a newer request, while this was in flight.
			if (this.cache.get(path) !== entry) return;
			entry.fetchedAt = Date.now();
			const json = JSON.stringify(fresh);
			if (json === entry.result?.json) return;
			entry.result = { value: fresh, json };
			entry.value = Promise.resolve(fresh);
			for (const listener of this.listeners) listener({ method: entry.method, url: entry.url });
		} catch {
			// Keep serving the cached response; the next use will try again.
		} finally {
			entry.revalidating = false;
		}
	}

	private async post<T>(
		method: string,
		body: object,
		invalidates: { urls?: string[]; methods?: string[] } = {},
	): Promise<T> {
		const result = await this.request<T>("POST", method, JSON.stringify(body));
		this.invalidate(invalidates);
		return result;
	}

	private async request<T>(httpMethod: "GET" | "POST", path: string, body?: string): Promise<T> {
		const apiKey = this.getApiKey();
		if (!apiKey) throw new SembleApiError("Add your Semble API key in the plugin settings.", 401);

		let response;
		try {
			// requestUrl bypasses CORS and works on mobile, unlike fetch.
			response = await requestUrl({
				url: `${BASE_URL}/${path}`,
				method: httpMethod,
				headers: { "x-api-key": apiKey, "X-Semble-Client": CLIENT_ID },
				contentType: body === undefined ? undefined : "application/json",
				body,
				throw: false,
			});
		} catch (err) {
			throw new SembleApiError(`Couldn't reach Semble: ${err instanceof Error ? err.message : String(err)}`, 0);
		}

		if (response.status >= 400) throw new SembleApiError(errorMessage(response), response.status);
		return response.json as T;
	}
}

function errorMessage(response: { status: number; text: string; json: unknown }): string {
	if (response.status === 401 || response.status === 403) {
		return "Semble rejected the API key. Check it in the plugin settings.";
	}
	try {
		const body = response.json as { message?: unknown; error?: unknown } | null;
		const message = body?.message ?? body?.error;
		if (typeof message === "string" && message) return message;
	} catch {
		// Not JSON; fall through.
	}
	return `Semble request failed (${response.status})`;
}
