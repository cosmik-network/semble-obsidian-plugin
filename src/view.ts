import {
	debounce,
	ItemView,
	Keymap,
	MarkdownView,
	Menu,
	Notice,
	SearchComponent,
	setIcon,
	TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { LinkDetail, type TabId } from "./detail/LinkDetail";
import { collapseDuplicates, extractLinks, type CollapsedLink, type WebLink } from "./links";
import type SemblePlugin from "./main";
import { openUrl } from "./ui";
import { hostOf } from "./urls";

export const VIEW_TYPE_LINKS = "semble-links";

/**
 * Sidebar pane listing every web link in the active note, modelled on the
 * core Outline view. Clicking a link opens a detail sub-view backed by Semble.
 *
 * The pane follows the most recently opened file (not the focused leaf), so
 * clicking into the pane keeps showing the note you came from.
 */
export class LinksView extends ItemView {
	private file: TFile | null = null;
	private links: WebLink[] = [];
	private filter = "";
	/** Incremented per refresh so a slow read can't overwrite a newer result. */
	private refreshId = 0;

	private listViewEl!: HTMLElement;
	private listEl!: HTMLElement;
	private detailEl!: HTMLElement;
	private detail: LinkDetail | null = null;
	/** Reopen link views on the tab the user last chose. */
	private detailTab: TabId = "library";

	private readonly requestRefresh = debounce(() => void this.refresh(), 250, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SemblePlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_LINKS;
	}

	getDisplayText(): string {
		return "Web links";
	}

	getIcon(): string {
		return "globe";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("semble-links-view");

		// The list stays in the DOM (just hidden) while a link is open, so its
		// filter and scroll position survive going back.
		this.listViewEl = this.contentEl.createDiv({ cls: "semble-links-list-view" });
		const searchEl = this.listViewEl.createDiv({ cls: "semble-links-search" });
		new SearchComponent(searchEl).setPlaceholder("Filter links...").onChange((value) => {
			this.filter = value.trim().toLowerCase();
			this.render();
		});
		this.listEl = this.listViewEl.createDiv({ cls: "semble-links-list" });
		this.detailEl = this.contentEl.createDiv({ cls: "semble-detail-container" });
		this.detailEl.hide();

		const { workspace, metadataCache, vault } = this.app;
		this.registerEvent(workspace.on("file-open", (file) => this.setFile(file)));
		this.registerEvent(
			metadataCache.on("changed", (file) => {
				if (file === this.file) this.requestRefresh();
			}),
		);
		this.registerEvent(
			vault.on("delete", (file) => {
				if (file === this.file) this.setFile(null);
			}),
		);

		this.setFile(workspace.getActiveFile());
	}

	async onClose(): Promise<void> {
		this.requestRefresh.cancel();
	}

	onSettingsChanged(): void {
		this.render();
		// Rebuild an open detail view, e.g. so a newly added API key takes effect.
		if (this.detail) this.openDetail(this.detail.link);
	}

	private setFile(file: TFile | null): void {
		if (file === this.file) return;
		this.file = file;
		this.links = [];
		this.closeDetail();
		void this.refresh();
	}

	/** Re-read the current note and rebuild the link list. */
	private async refresh(): Promise<void> {
		const id = ++this.refreshId;
		const file = this.file;
		if (!file || file.extension !== "md") {
			this.links = [];
			this.render();
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		if (id !== this.refreshId) return;
		this.links = extractLinks(content, this.app.metadataCache.getFileCache(file));
		this.render();
	}

	// --- Detail sub-view ---

	private openDetail(link: WebLink): void {
		this.closeDetail();
		this.listViewEl.hide();
		this.detailEl.show();
		this.detail = this.addChild(
			new LinkDetail(this.detailEl, this.plugin, link, {
				back: () => this.closeDetail(),
				revealInNote: (target) => void this.revealInNote(target),
				noteLinks: () => this.links,
				initialTab: this.detailTab,
				onTabChange: (tab) => (this.detailTab = tab),
				overlayEl: this.contentEl,
			}),
		);
	}

	private closeDetail(): void {
		if (!this.detail) return;
		this.removeChild(this.detail);
		this.detail = null;
		this.detailEl.hide();
		this.listViewEl.show();
	}

	// --- List ---

	/** Redraw from the last extracted links using the current settings and filter. */
	render(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		if (!this.file) return this.renderEmpty("No file is open.");
		if (this.file.extension !== "md") return this.renderEmpty("Links are only listed for Markdown notes.");

		const { settings } = this.plugin;
		let links = this.links;
		if (!settings.includeImages) links = links.filter((link) => !link.image);
		if (this.filter) links = links.filter((link) => matchesFilter(link, this.filter));
		if (links.length === 0) {
			return this.renderEmpty(this.filter ? "No links match the filter." : "No web links in this note.");
		}

		const items = settings.collapseDuplicates
			? collapseDuplicates(links)
			: links.map((link): CollapsedLink => ({ link, count: 1 }));
		for (const item of items) this.renderItem(item);
	}

	private renderEmpty(message: string): void {
		this.listEl.createDiv({ cls: "pane-empty", text: message });
	}

	private renderItem({ link, count }: CollapsedLink): void {
		// Reuse core tree-item classes so the pane matches Outline/Backlinks styling and themes.
		const itemEl = this.listEl.createDiv({ cls: "tree-item semble-links-item" });
		const selfEl = itemEl.createDiv({ cls: "tree-item-self is-clickable" });
		selfEl.setAttr("aria-label", link.url);
		selfEl.setAttr("data-tooltip-position", "left");

		setIcon(selfEl.createDiv({ cls: "semble-links-item-icon" }), link.image ? "image" : "globe");

		const innerEl = selfEl.createDiv({ cls: "tree-item-inner" });
		innerEl.createDiv({ cls: "semble-links-item-title", text: link.displayText });
		const host = hostOf(link.url);
		if (host && host !== link.displayText) innerEl.createDiv({ cls: "semble-links-item-detail", text: host });

		if (count > 1) {
			selfEl.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair", text: String(count) });
		}

		selfEl.addEventListener("click", (evt) => {
			if (Keymap.isModEvent(evt)) openUrl(link.url);
			else this.openDetail(link);
		});
		selfEl.addEventListener("contextmenu", (evt) => this.showMenu(link, evt));
	}

	private showMenu(link: WebLink, evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Show in Semble").setIcon("info").onClick(() => this.openDetail(link)));
		menu.addItem((item) => item.setTitle("Open link").setIcon("external-link").onClick(() => openUrl(link.url)));
		menu.addItem((item) =>
			item.setTitle("Jump to link in note").setIcon("text-cursor").onClick(() => this.revealInNote(link)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Copy URL")
				.setIcon("copy")
				.onClick(async () => {
					await navigator.clipboard.writeText(link.url);
					new Notice("Copied to clipboard");
				}),
		);
		menu.showAtMouseEvent(evt);
	}

	/** Focus the note and select the link's source text, like clicking a heading in Outline. */
	private async revealInNote(link: WebLink): Promise<void> {
		const file = this.file;
		if (!file) return;
		const { position } = link;

		const { workspace } = this.app;
		let leaf = workspace
			.getLeavesOfType("markdown")
			.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file === file);
		if (!leaf) {
			leaf = workspace.getLeaf(false);
			await leaf.openFile(file);
		}
		workspace.setActiveLeaf(leaf, { focus: true });

		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		if (view.getMode() === "source") {
			const from = { line: position.start.line, ch: position.start.col };
			const to = { line: position.end.line, ch: position.end.col };
			view.editor.setSelection(from, to);
			view.editor.scrollIntoView({ from, to }, true);
		} else {
			view.setEphemeralState({ line: position.start.line });
		}
	}
}

function matchesFilter(link: WebLink, filter: string): boolean {
	return link.displayText.toLowerCase().includes(filter) || link.url.toLowerCase().includes(filter);
}
