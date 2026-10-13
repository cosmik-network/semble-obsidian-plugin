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
