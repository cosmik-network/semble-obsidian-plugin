import { Component, setIcon } from "obsidian";
import type { Panel } from "./context";

export interface SectionOptions {
	title: string;
	open: boolean;
	/** Creates the content panel; called the first time the section is opened. */
	createPanel: (containerEl: HTMLElement) => Panel;
	onToggle: (open: boolean) => void;
}

/**
 * Collapsible section built from core `tree-item` markup, like the "Linked
 * mentions" and "Unlinked mentions" groups in Backlinks. Content loads lazily
 * on first open and is kept while collapsed, so reopening is instant.
 */
export class Section extends Component {
	private open: boolean;
	private panel: Panel | null = null;
	private itemEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private flairEl!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(
		private readonly parentEl: HTMLElement,
		private readonly options: SectionOptions,
	) {
		super();
		this.open = options.open;
	}

	onload(): void {
		this.itemEl = this.parentEl.createDiv({ cls: "tree-item semble-section" });
		this.headerEl = this.itemEl.createDiv({
			cls: "tree-item-self is-clickable mod-collapsible semble-section-header",
			attr: { role: "button", tabindex: "0" },
		});
		setIcon(this.headerEl.createDiv({ cls: "tree-item-icon collapse-icon" }), "right-triangle");
		this.headerEl.createDiv({ cls: "tree-item-inner", text: this.options.title });
		this.flairEl = this.headerEl.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair" });
		this.bodyEl = this.itemEl.createDiv({ cls: "tree-item-children semble-section-body" });

		this.headerEl.addEventListener("click", () => this.toggle());
		this.headerEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.toggle();
			}
		});
		this.setFlair(null);
		this.sync();
		if (this.open) this.mount();
	}

	onunload(): void {
		this.itemEl.remove();
	}

	/** Count or label next to the title, e.g. "12" or "Saved". */
	setFlair(text: string | null): void {
		this.flairEl.setText(text ?? "");
		this.flairEl.toggle(Boolean(text));
	}

	/** Drop the content so it's fetched again next time it's shown. */
	reload(): void {
		if (this.panel) {
			this.removeChild(this.panel);
			this.panel = null;
		}
		if (this.open) this.mount();
	}

	private toggle(): void {
		this.open = !this.open;
		this.sync();
		if (this.open && !this.panel) this.mount();
		this.options.onToggle(this.open);
	}

	private sync(): void {
		this.itemEl.toggleClass("is-collapsed", !this.open);
		this.headerEl.setAttr("aria-expanded", String(this.open));
		this.bodyEl.toggle(this.open);
	}

	private mount(): void {
		this.panel = this.addChild(this.options.createPanel(this.bodyEl));
	}
}
