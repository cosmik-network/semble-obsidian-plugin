import { App, Component } from "obsidian";
import type { SembleClient, UrlInfo } from "../api";
import type { WebLink } from "../links";
import { renderMessage, renderRow } from "../ui";

/** What the sections of a link's detail view share. */
export interface DetailContext {
	app: App;
	api: SembleClient;
	/** The link being viewed. */
	link: WebLink;
	/** Header metadata and stats, once loaded. */
	info(): UrlInfo | null;
	/** Web links in the current note other than this one, unique by URL. */
	otherNoteLinks(): WebLink[];
	/** Reload the header and every section, e.g. after saving a change. */
	refresh(): void;
}

/**
 * Base for a section's content. Content loads asynchronously, so `alive` lets
 * it drop results that arrive after the section was closed or reloaded.
 */
export abstract class Panel extends Component {
	protected alive = false;

	constructor(
		protected readonly containerEl: HTMLElement,
		protected readonly ctx: DetailContext,
	) {
		super();
	}

	onload(): void {
		this.alive = true;
		void this.init();
	}

	onunload(): void {
		this.alive = false;
		this.containerEl.empty();
	}

	/**
	 * Whether the panel can be rebuilt when fresh data arrives. Panels say no
	 * while the user is in the middle of something a rebuild would throw away.
	 */
	canRefresh(): boolean {
		return true;
	}

	protected abstract init(): Promise<void>;
}

/** A panel that lists paged results, with a "Load more" row when there are more. */
export abstract class PagedPanel<T> extends Panel {
	protected listEl!: HTMLElement;
	protected page = 1;
	private request = 0;

	protected abstract readonly emptyText: string;
	protected abstract fetchPage(page: number): Promise<{ items: T[]; hasMore: boolean }>;
	protected abstract renderItem(item: T): void;

	/** Not after "Load more": a rebuild would drop back to the first page. */
	canRefresh(): boolean {
		return this.page === 1;
	}

	/** Controls above the list, e.g. a filter. */
	protected renderControls(): void {}

	protected async init(): Promise<void> {
		this.renderControls();
		this.listEl = this.containerEl.createDiv();
		await this.reset();
	}

	/** Start again from the first page, e.g. after a filter changes. */
	protected async reset(): Promise<void> {
		this.page = 1;
		this.listEl.empty();
		await this.loadPage();
	}

	private async loadPage(): Promise<void> {
		const request = ++this.request;
		const loadingEl = renderMessage(this.listEl, "Loading…");
		try {
			const { items, hasMore } = await this.fetchPage(this.page);
			if (!this.alive || request !== this.request) return;
			loadingEl.remove();
			if (items.length === 0 && this.page === 1) renderMessage(this.listEl, this.emptyText);
			for (const item of items) this.renderItem(item);
			if (hasMore) {
				const moreEl = renderRow(this.listEl, {
					icon: "chevrons-down",
					title: "Load more",
					onClick: () => {
						moreEl.remove();
						this.page++;
						void this.loadPage();
					},
				});
				moreEl.addClass("mod-load-more");
			}
		} catch (err) {
			if (!this.alive || request !== this.request) return;
			loadingEl.remove();
			renderMessage(this.listEl, err instanceof Error ? err.message : String(err), () => void this.loadPage());
		}
	}
}
