/* URL helpers with no Obsidian dependencies, shared by the API client and the UI. */

/** Hostname without a leading "www.", or null if the URL can't be parsed. */
export function hostOf(url: string): string | null {
	try {
		return new URL(url).host.replace(/^www\./, "") || null;
	} catch {
		return null;
	}
}

/**
 * Compare URLs the way Semble does: it normalizes them (e.g. adds a trailing
 * slash to bare domains), so an exact string match isn't reliable.
 */
export function sameUrl(a: string, b: string): boolean {
	return normalizeUrl(a) === normalizeUrl(b);
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
	} catch {
		return value;
	}
}

export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

const SEMBLE_WEB = "https://semble.so";

export function sembleProfileUrl(handle: string): string {
	return `${SEMBLE_WEB}/profile/${encodeURIComponent(handle)}`;
}

/**
 * Web page for a collection: its owner's profile plus the record key, the
 * last segment of the collection's AT URI. Null if the URI is missing.
 */
export function sembleCollectionUrl(handle: string, atUri: string | undefined): string | null {
	const rkey = atUri?.split("/").pop();
	if (!rkey || !atUri?.startsWith("at://")) return null;
	return `${sembleProfileUrl(handle)}/collections/${encodeURIComponent(rkey)}`;
}

/**
 * Semble's page for a web link. Every link the plugin opens goes here rather
 * than to the site itself, except links to Semble collections, which open as
 * they are.
 */
export function sembleUrlPage(url: string): string {
	return isSembleCollectionUrl(url) ? url : `${SEMBLE_WEB}/url?id=${encodeURIComponent(url)}`;
}

/** A Semble collection page: semble.so/profile/<handle>/collections/<rkey>. */
function isSembleCollectionUrl(url: string): boolean {
	try {
		const { hostname, pathname } = new URL(url);
		const host = hostname.toLowerCase();
		return (
			(host === "semble.so" || host === "www.semble.so") &&
			/^\/profile\/[^/]+\/collections\/[^/]+\/?$/.test(pathname)
		);
	} catch {
		return false;
	}
}
