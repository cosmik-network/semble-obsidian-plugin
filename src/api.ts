import { requestUrl } from "obsidian";

/*
 * Minimal typed client for the parts of the Semble XRPC API the plugin uses.
 * Types cover only the fields we read; the API returns more.
 */

const BASE_URL = "https://api.semble.so/xrpc";
/** Identifies this integration to Semble via the optional X-Semble-Client header. */
const CLIENT_ID = "obsidian";

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
	name: string;
	description?: string;
	accessType?: "OPEN" | "CLOSED";
	cardCount: number;
	author: User;
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

export class SembleClient {
	private profile: Promise<User> | null = null;

	/** `getApiKey` is read on every request so key changes apply immediately. */
	constructor(private readonly getApiKey: () => string | null) {}

	get hasApiKey(): boolean {
		return Boolean(this.getApiKey());
	}

	/** Forget cached per-account data, e.g. after the API key changes. */
	reset(): void {
		this.profile = null;
	}

	// --- Account ---

	getMyProfile(): Promise<User> {
		this.profile ??= this.get<User>("network.cosmik.actor.getMyProfile").catch((err: unknown) => {
			this.profile = null;
			throw err;
		});
		return this.profile;
	}

	// --- URLs and library ---

	getUrlInfo(url: string): Promise<UrlInfo> {
		return this.get("network.cosmik.card.getUrlMetadata", { url, includeStats: true });
	}

	async getLibraryStatus(url: string): Promise<LibraryStatus> {
		try {
			return await this.get<LibraryStatus>("network.cosmik.card.getLibraryStatus", { url });
		} catch (err) {
			if (err instanceof SembleApiError && err.status === 404) return {};
			throw err;
		}
	}

	addUrl(body: { url: string; note?: string; collectionIds?: string[] }): Promise<{ urlCardId: string }> {
		return this.post("network.cosmik.card.addUrl", body);
	}

	updateUrlAssociations(body: {
		cardId: string;
		note?: string;
		addToCollections?: string[];
		removeFromCollections?: string[];
	}): Promise<unknown> {
		return this.post("network.cosmik.card.updateUrlAssociations", body);
	}

	removeFromLibrary(cardId: string): Promise<unknown> {
		return this.post("network.cosmik.card.removeFromLibrary", { cardId });
	}

	getSimilarUrls(
		url: string,
		options: { urlType?: UrlType; page?: number; limit?: number } = {},
	): Promise<{ urls: UrlView[]; pagination: Pagination }> {
		return this.get("network.cosmik.search.getSimilarUrls", { url, ...options });
	}

	// --- Collections ---

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
		return this.post("network.cosmik.collection.create", { name });
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
		return this.post("network.cosmik.connection.create", {
			sourceType: "URL",
			sourceValue: body.sourceUrl,
			targetType: "URL",
			targetValue: body.targetUrl,
			connectionType: body.connectionType,
			note: body.note,
		});
	}

	deleteConnection(connectionId: string): Promise<unknown> {
		return this.post("network.cosmik.connection.delete", { connectionId });
	}

	// --- Transport ---

	private get<T>(method: string, query: Query = {}): Promise<T> {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) params.set(key, String(value));
		}
		const qs = params.toString();
		return this.request<T>("GET", `${method}${qs ? `?${qs}` : ""}`);
	}

	private post<T>(method: string, body: object): Promise<T> {
		return this.request<T>("POST", method, JSON.stringify(body));
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
