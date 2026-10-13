import { Component, debounce, setIcon } from "obsidian";
import { API_KEYS_URL, type UrlInfo } from "../api";
import type { WebLink } from "../links";
import type SemblePlugin from "../main";
import { errorText, openLink, plural, renderToggleGroup, type ToggleGroup } from "../ui";
import { hostOf, sameUrl } from "../urls";
import { ConnectionsPanel } from "./ConnectionsPanel";
import type { DetailContext, Panel } from "./context";
import { LibraryPanel } from "./LibraryPanel";
import { CollectionsPanel, RelatedPanel, SavedByPanel } from "./lists";

type PanelClass = new (el: HTMLElement, ctx: DetailContext) => Panel;

/** Tabs in the tab bar. */
type TabId = "library" | "connections" | "related";
/** Lists opened from the stats; they share the tab content area. */
type StatViewId = "savedBy" | "collections";
export type ViewId = TabId | StatViewId;

export interface LinkDetailHost {
	back(): void;
	revealInNote(link: WebLink): void;
	noteLinks(): WebLink[];
	/** The view to start on, and a callback to remember the user's choice. */
	initialView: ViewId;
	onViewChange(view: ViewId): void;
}

const TABS: { id: TabId; label: string; Panel: PanelClass }[] = [
	{ id: "library", label: "Add", Panel: LibraryPanel },
	{ id: "related", label: "Related", Panel: RelatedPanel },
	{ id: "connections", label: "Connections", Panel: ConnectionsPanel },
];

const STAT_VIEWS: Record<StatViewId, { title: string; Panel: PanelClass }> = {
	savedBy: { title: "Saved by", Panel: SavedByPanel },
	collections: { title: "In collections", Panel: CollectionsPanel },
};

function isTab(id: ViewId): id is TabId {
	return TABS.some((tab) => tab.id === id);
}

/**
 * Sub-view for one link, laid out like Semble's browser extension (header,
 * stats, tabs) but built from Obsidian's own toolbar buttons, rows, inputs
 * and modals so it matches the rest of the app.
 */
export class LinkDetail extends Component {
	private info: UrlInfo | null = null;
	private infoError: string | null = null;
	private view: ViewId;
	private panel: Panel | null = null;
	private tabs: ToggleGroup<TabId> | null = null;
	/** Stat elements that open a view, so the active one can be highlighted. */
	private readonly statEls = new Map<ViewId, HTMLElement>();
	private alive = false;

	private headerEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private readonly ctx: DetailContext;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly plugin: SemblePlugin,
		readonly link: WebLink,
		private readonly host: LinkDetailHost,
	) {
		super();
		this.view = host.initialView;
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

		this.tabs = renderToggleGroup(
			scrollEl,
			TABS.map(({ id, label }) => ({ id, label })),
			isTab(this.view) ? this.view : null,
			(id) => this.showView(id),
			"semble-tabs",
		);
		this.bodyEl = scrollEl.createDiv({ cls: "semble-tab-body" });

		// Everything renders from the cache straight away and is checked again in
		// the background; when something about this link actually changed, redraw.
		this.register(
			this.plugin.api.onChange((change) => {
				if (change.url === undefined || sameUrl(change.url, this.link.url)) this.applyFreshData();
			}),
		);
		this.register(() => this.applyFreshData.cancel());
		this.refresh();
	}

	/** Redraw the header, and the current tab unless the user is mid-edit. Batches bursts of changes. */
	private readonly applyFreshData = debounce(
		() => {
			if (!this.alive) return;
			void this.loadInfo();
			if (this.panel?.canRefresh()) this.showView(this.view, true);
		},
		100,
		true,
	);

	onunload(): void {
		this.alive = false;
		this.containerEl.empty();
	}

	private refresh(): void {
		void this.loadInfo();
		this.showView(this.view, true);
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
		button("text-cursor", "Jump to link in note", () => this.host.revealInNote(this.link));
		button("external-link", "Open on Semble", () => openLink(this.link.url));
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
	}

	/** Site, title and description, then the stats, as in the extension. */
	private renderHeader(): void {
		const { headerEl, link, info } = this;
		headerEl.empty();
		const metadata = info?.metadata;

		const topEl = headerEl.createDiv({ cls: "semble-detail-top" });
		const textEl = topEl.createDiv({ cls: "semble-detail-text" });
		const siteEl = textEl.createDiv({ cls: "semble-detail-site" });
		siteEl.createSpan({ text: hostOf(link.url) ?? link.url });
		if (info?.urlInLibrary) {
			const savedEl = siteEl.createSpan({ cls: "semble-saved", attr: { "aria-label": "In your library" } });
			setIcon(savedEl, "check");
			savedEl.createSpan({ text: "Saved" });
		}
		textEl.createDiv({ cls: "semble-detail-title", text: metadata?.title || link.displayText });
		if (metadata?.description) textEl.createDiv({ cls: "semble-detail-desc", text: metadata.description });

		if (this.infoError) headerEl.createDiv({ cls: "semble-detail-error", text: this.infoError });
		if (!info?.stats) return;

		// Each stat opens its list in the tab content area, like an extra tab.
		const { stats } = info;
		const statsEl = headerEl.createDiv({ cls: "semble-stats" });
		this.statEls.clear();
		const statItems: [number, string, ViewId][] = [
			[stats.libraryCount, "save", "savedBy"],
			[stats.collectionCount, "collection", "collections"],
			[stats.connections.all.total, "connection", "connections"],
		];
		for (const [count, label, view] of statItems) {
			const statEl = statsEl.createSpan({ cls: "semble-stat" });
			statEl.createEl("strong", { text: String(count) });
			statEl.appendText(` ${plural(count, label).split(" ").slice(1).join(" ")}`);
			if (count === 0) continue;
			statEl.addClass("is-clickable");
			statEl.setAttrs({ role: "button", tabindex: "0" });
			statEl.addEventListener("click", () => this.showView(view));
			statEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") this.showView(view);
			});
			this.statEls.set(view, statEl);
		}
		this.highlightStat();
	}

	private highlightStat(): void {
		for (const [view, el] of this.statEls) el.toggleClass("is-active", view === this.view && !isTab(view));
	}

	/** Show a tab, or a stat's list, in the content area below the tab bar. */
	private showView(id: ViewId, reload = false): void {
		if (this.panel && id === this.view && !reload) return;
		this.view = id;
		this.host.onViewChange(id);
		this.tabs?.setActive(isTab(id) ? id : null);
		this.highlightStat();

		if (this.panel) this.removeChild(this.panel);
		this.bodyEl.empty();
		let Panel: PanelClass;
		let bodyEl = this.bodyEl;
		if (isTab(id)) {
			Panel = (TABS.find((t) => t.id === id) ?? TABS[0]!).Panel;
		} else {
			const statView = STAT_VIEWS[id];
			Panel = statView.Panel;
			this.bodyEl.createDiv({ cls: "semble-view-title", text: statView.title });
			bodyEl = this.bodyEl.createDiv();
		}
		this.panel = this.addChild(new Panel(bodyEl, this.ctx));
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
