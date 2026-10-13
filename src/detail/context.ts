import { App, Component } from "obsidian";
import type { SembleClient, UrlInfo } from "../api";
import type { WebLink } from "../links";

/** What the tabs of a link's detail view share. */
export interface DetailContext {
	app: App;
	api: SembleClient;
	/** The link being viewed. */
	link: WebLink;
	/** Header metadata and stats, once loaded. */
	info(): UrlInfo | null;
	/** Web links in the current note other than this one, unique by URL. */
	otherNoteLinks(): WebLink[];
	/** Reload the header and current tab, e.g. after saving a change. */
	refresh(): void;
	/** Return to the list of links. */
	back(): void;
}

/**
 * Base for a tab's content. Tabs load data asynchronously, so `alive` lets
 * them drop results that arrive after the user has moved on.
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

	protected abstract init(): Promise<void>;
}
