import { Component, setIcon } from "obsidian";
import { API_KEYS_URL, type UrlInfo } from "../api";
import type { WebLink } from "../links";
import type SemblePlugin from "../main";
import { errorText, hostOf, openUrl, plural, renderThumbnail, sameUrl } from "../ui";
import { ConnectionsTab } from "./ConnectionsTab";
import type { DetailContext, Panel } from "./context";
import { LibraryTab } from "./LibraryTab";
import { RelatedTab } from "./RelatedTab";

type TabId = "library" | "related" | "connections";

export interface LinkDetailHost {
	back(): void;
	revealInNote(link: WebLink): void;
	noteLinks(): WebLink[];
}

/**
 * Sub-view for one link: Semble metadata and stats, plus tabs to save it to
 * the library, browse related links, and manage connections.
 */
export class LinkDetail extends Component {
	private info: UrlInfo | null = null;
	private infoError: string | null = null;
	private tab: TabId = "library";
	private panel: Panel | null = null;
	private alive = false;

	private headerEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private bodyEl!: HTMLElement;
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
			back: () => host.back(),
		};
	}

	onload(): void {
		this.alive = true;
		this.containerEl.addClass("semble-detail");
		this.renderNav();
		this.headerEl = this.containerEl.createDiv({ cls: "semble-detail-header" });

		if (!this.plugin.api.hasApiKey) {
			this.renderHeader();
			this.renderConnectPrompt();
			return;
		}

		this.tabsEl = this.containerEl.createDiv({ cls: "semble-tabs", attr: { role: "tablist" } });
		this.bodyEl = this.containerEl.createDiv({ cls: "semble-tab-body" });
		this.refresh();
	}

	onunload(): void {
		this.alive = false;
		this.containerEl.empty();
		this.containerEl.removeClass("semble-detail");
	}

	private refresh(): void {
		void this.loadInfo();
		this.showTab(this.tab);
	}

	private renderNav(): void {
		const navEl = this.containerEl.createDiv({ cls: "semble-detail-nav" });
		const backEl = navEl.createDiv({ cls: "clickable-icon semble-back", attr: { "aria-label": "Back to links" } });
		setIcon(backEl, "arrow-left");
		backEl.createSpan({ text: "Links" });
		backEl.addEventListener("click", () => this.host.back());

		navEl.createDiv({ cls: "semble-spacer" });
		const revealEl = navEl.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Jump to link in note" } });
		setIcon(revealEl, "text-cursor");
		revealEl.addEventListener("click", () => this.host.revealInNote(this.link));
		const openEl = navEl.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Open link" } });
		setIcon(openEl, "external-link");
		openEl.addEventListener("click", () => openUrl(this.link.url));
	}

	private async loadInfo(): Promise<void> {
		this.infoError = null;
		this.renderHeader();
		try {
			const info = await this.plugin.api.getUrlInfo(this.link.url);
			if (!this.alive) return;
			this.info = info;
		} catch (err) {
			if (!this.alive) return;
			this.infoError = errorText(err);
		}
		this.renderHeader();
		this.renderTabs();
	}

	private renderHeader(): void {
		const { headerEl, link, info } = this;
		headerEl.empty();
		const metadata = info?.metadata;

		const textEl = headerEl.createDiv({ cls: "semble-detail-header-text" });
		const siteEl = textEl.createDiv({ cls: "semble-card-site" });
		siteEl.createSpan({ text: hostOf(link.url) ?? link.url });
		if (info?.urlInLibrary) siteEl.createSpan({ cls: "semble-badge mod-success", text: "In library" });

		textEl.createDiv({ cls: "semble-detail-title", text: metadata?.title || link.displayText });
		if (metadata?.description) textEl.createDiv({ cls: "semble-card-desc", text: metadata.description });

		if (info?.stats) {
			const { stats } = info;
			const statsEl = textEl.createDiv({ cls: "semble-stats" });
			for (const [count, label] of [
				[stats.libraryCount, "save"],
				[stats.collectionCount, "collection"],
				[stats.connections.all.total, "connection"],
			] as const) {
				const [num, ...words] = plural(count, label).split(" ");
				const statEl = statsEl.createSpan({ cls: "semble-stat" });
				statEl.createEl("strong", { text: num });
				statEl.appendText(` ${words.join(" ")}`);
			}
		} else if (this.plugin.api.hasApiKey && !this.infoError) {
			textEl.createDiv({ cls: "semble-muted", text: "Loading from Semble…" });
		}
		if (this.infoError) textEl.createDiv({ cls: "semble-error", text: this.infoError });

		if (metadata?.imageUrl) renderThumbnail(headerEl, metadata.imageUrl);
	}

	private renderConnectPrompt(): void {
		const promptEl = this.containerEl.createDiv({ cls: "semble-connect" });
		promptEl.createEl("p", { text: "Connect Semble to save this link, see related links and add connections." });
		const steps = promptEl.createEl("ol");
		const first = steps.createEl("li");
		first.appendText("Create an API key at ");
		first.createEl("a", { text: "semble.so", href: API_KEYS_URL });
		first.appendText(".");
		steps.createEl("li", { text: "Paste it into the API key field in the Semble plugin settings." });
	}

	private renderTabs(): void {
		this.tabsEl.empty();
		const tabs: [TabId, string][] = [
			["library", this.info?.urlInLibrary ? "Update" : "Add"],
			["related", "Related"],
			["connections", "Connections"],
		];
		for (const [id, label] of tabs) {
			const tabEl = this.tabsEl.createEl("button", { cls: "semble-tab", text: label, attr: { role: "tab" } });
			tabEl.toggleClass("is-active", id === this.tab);
			tabEl.setAttr("aria-selected", String(id === this.tab));
			tabEl.addEventListener("click", () => this.showTab(id));
		}
	}

	private showTab(id: TabId): void {
		this.tab = id;
		this.renderTabs();
		if (this.panel) this.removeChild(this.panel);
		this.bodyEl.empty();

		const Tab = { library: LibraryTab, related: RelatedTab, connections: ConnectionsTab }[id];
		this.panel = this.addChild(new Tab(this.bodyEl, this.ctx));
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
