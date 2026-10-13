import { Component, setIcon } from "obsidian";
import { API_KEYS_URL, COLLECTION_LISTS, type UrlInfo } from "../api";
import type { WebLink } from "../links";
import type SemblePlugin from "../main";
import { errorText, openUrl } from "../ui";
import { hostOf, sameUrl } from "../urls";
import { ConnectionsPanel } from "./ConnectionsPanel";
import type { DetailContext, Panel } from "./context";
import { LibraryPanel } from "./LibraryPanel";
import { CollectionsPanel, RelatedPanel, SavedByPanel } from "./lists";
import { Section } from "./Section";

export type SectionId = "library" | "connections" | "related" | "savedBy" | "collections";

export interface LinkDetailHost {
	back(): void;
	revealInNote(link: WebLink): void;
	noteLinks(): WebLink[];
	/** Which sections start open, and a callback to remember the user's choice. */
	openSections: ReadonlySet<SectionId>;
	onSectionToggle(id: SectionId, open: boolean): void;
}

const SECTIONS: { id: SectionId; title: string; Panel: new (el: HTMLElement, ctx: DetailContext) => Panel }[] = [
	{ id: "library", title: "Library", Panel: LibraryPanel },
	{ id: "connections", title: "Connections", Panel: ConnectionsPanel },
	{ id: "related", title: "Related", Panel: RelatedPanel },
	{ id: "savedBy", title: "Saved by", Panel: SavedByPanel },
	{ id: "collections", title: "In collections", Panel: CollectionsPanel },
];

/**
 * Sub-view for one link: a header with Semble's metadata, then collapsible
 * sections (like Backlinks) to save the link, manage its connections, and see
 * related links, who saved it, and which collections it's in.
 */
export class LinkDetail extends Component {
	private info: UrlInfo | null = null;
	private infoError: string | null = null;
	private alive = false;
	private readonly sections = new Map<SectionId, Section>();

	private headerEl!: HTMLElement;
	private readonly ctx: DetailContext;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly plugin: SemblePlugin,
		readonly link: WebLink,
		private readonly host: LinkDetailHost,
	) {
		super();
		this.ctx = {
			app: plugin.app,
			api: plugin.api,
			link,
			info: () => this.info,
			otherNoteLinks: () => uniqueOtherLinks(host.noteLinks(), link.url),
			refresh: () => this.refresh(),
		};
	}

	onload(): void {
		this.alive = true;
		this.renderNav();
		const scrollEl = this.containerEl.createDiv({ cls: "semble-detail-scroll" });
		this.headerEl = scrollEl.createDiv({ cls: "semble-detail-header" });

		if (!this.plugin.api.hasApiKey) {
			this.renderHeader();
			this.renderConnectPrompt(scrollEl);
			return;
		}

		const sectionsEl = scrollEl.createDiv({ cls: "semble-sections" });
		for (const { id, title, Panel } of SECTIONS) {
			const section = new Section(sectionsEl, {
				title,
				open: this.host.openSections.has(id),
				createPanel: (el) => new Panel(el, this.ctx),
				onToggle: (open) => this.host.onSectionToggle(id, open),
			});
			this.sections.set(id, this.addChild(section));
		}
		void this.loadInfo();
	}

	onunload(): void {
		this.alive = false;
		this.containerEl.empty();
	}

	private refresh(): void {
		void this.loadInfo();
		for (const section of this.sections.values()) section.reload();
	}

	/** Core nav-header markup, the same toolbar Outline and Backlinks use. */
	private renderNav(): void {
		const buttonsEl = this.containerEl
			.createDiv({ cls: "nav-header" })
			.createDiv({ cls: "nav-buttons-container" });
		const button = (icon: string, label: string, onClick: () => void) => {
			const el = buttonsEl.createDiv({ cls: "clickable-icon nav-action-button", attr: { "aria-label": label } });
			setIcon(el, icon);
			el.addEventListener("click", onClick);
		};

		button("arrow-left", "Back to links", () => this.host.back());
		if (this.plugin.api.hasApiKey) {
			button("refresh-cw", "Reload from Semble", () => {
				// Responses are cached for a few minutes; this fetches fresh ones for this link.
				this.plugin.api.invalidate({ urls: [this.link.url], methods: COLLECTION_LISTS });
				this.refresh();
			});
		}
		button("text-cursor", "Jump to link in note", () => this.host.revealInNote(this.link));
		button("external-link", "Open link", () => openUrl(this.link.url));
	}

	private async loadInfo(): Promise<void> {
		this.infoError = null;
		try {
			const info = await this.plugin.api.getUrlInfo(this.link.url);
			if (!this.alive) return;
			this.info = info;
		} catch (err) {
			if (!this.alive) return;
			this.infoError = errorText(err);
		}
		this.renderHeader();
		this.updateCounts();
	}

	private renderHeader(): void {
		const { headerEl, link, info } = this;
		headerEl.empty();
		const metadata = info?.metadata;

		headerEl.createDiv({ cls: "semble-detail-title", text: metadata?.title || link.displayText });
		const site = [metadata?.siteName, hostOf(link.url)].filter(Boolean);
		headerEl.createDiv({ cls: "semble-detail-site", text: [...new Set(site)].join(" · ") || link.url });
		if (metadata?.description) headerEl.createDiv({ cls: "semble-detail-desc", text: metadata.description });
		if (this.infoError) headerEl.createDiv({ cls: "semble-detail-error", text: this.infoError });
	}

	/** Stats become counts next to the section titles, like Backlinks' mention counts. */
	private updateCounts(): void {
		const stats = this.info?.stats;
		const count = (n: number | undefined) => (n ? String(n) : null);
		this.sections.get("library")?.setFlair(this.info?.urlInLibrary ? "Saved" : null);
		this.sections.get("connections")?.setFlair(count(stats?.connections.all.total));
		this.sections.get("savedBy")?.setFlair(count(stats?.libraryCount));
		this.sections.get("collections")?.setFlair(count(stats?.collectionCount));
	}

	private renderConnectPrompt(parentEl: HTMLElement): void {
		const promptEl = parentEl.createDiv({ cls: "semble-message" });
		promptEl.createEl("p", { text: "Connect Semble to save this link, see related links and add connections." });
		const steps = promptEl.createEl("ol");
		const first = steps.createEl("li");
		first.appendText("Create an API key at ");
		first.createEl("a", { text: "semble.so", href: API_KEYS_URL });
		first.appendText(".");
		steps.createEl("li", { text: "Paste it into the API key field in the Semble plugin settings." });
	}
}

function uniqueOtherLinks(links: WebLink[], url: string): WebLink[] {
	const seen: string[] = [url];
	return links.filter((link) => {
		if (seen.some((other) => sameUrl(other, link.url))) return false;
		seen.push(link.url);
		return true;
	});
}
