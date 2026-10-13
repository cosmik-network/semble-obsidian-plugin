import { App, Modal, Setting, setIcon } from "obsidian";
import type { UrlMetadata } from "./api";
import { hostOf } from "./urls";

/** Obsidian routes window.open for http(s) URLs to the system browser (or Web viewer, if enabled). */
export function openUrl(url: string): void {
	window.open(url);
}

export function errorText(err: unknown): string {
	return err instanceof Error ? err.message : "Something went wrong.";
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Muted placeholder text, with an optional retry button for failed loads. */
export function renderMessage(parentEl: HTMLElement, text: string, retry?: () => void): HTMLElement {
	const el = parentEl.createDiv({ cls: "semble-message" });
	el.createDiv({ text });
	if (retry) {
		const button = el.createEl("button", { text: "Try again" });
		button.addEventListener("click", retry);
	}
	return el;
}

export interface UrlCardOptions {
	/** Small label next to the host, e.g. "This link". */
	badge?: string;
	onClick?: (evt: MouseEvent) => void;
}

/** Compact card for a URL: host, title, description and thumbnail, like Semble's own cards. */
export function renderUrlCard(
	parentEl: HTMLElement,
	metadata: UrlMetadata,
	options: UrlCardOptions = {},
): HTMLElement {
	const cardEl = parentEl.createDiv({ cls: "semble-card" });
	const textEl = cardEl.createDiv({ cls: "semble-card-text" });

	const siteEl = textEl.createDiv({ cls: "semble-card-site" });
	siteEl.createSpan({ text: hostOf(metadata.url) ?? metadata.url });
	if (options.badge) siteEl.createSpan({ cls: "semble-badge", text: options.badge });

	textEl.createDiv({ cls: "semble-card-title", text: metadata.title || metadata.url });
	if (metadata.description) textEl.createDiv({ cls: "semble-card-desc", text: metadata.description });

	if (metadata.imageUrl) renderThumbnail(cardEl, metadata.imageUrl);

	if (options.onClick) {
		const onClick = options.onClick;
		cardEl.addClass("is-clickable");
		cardEl.setAttr("aria-label", metadata.url);
		cardEl.addEventListener("click", (evt) => onClick(evt));
	}
	return cardEl;
}

export function renderThumbnail(parentEl: HTMLElement, src: string, cls = "semble-thumb"): void {
	const img = parentEl.createEl("img", { cls, attr: { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } });
	img.addEventListener("error", () => img.remove());
}

/** Pill-shaped toggle button, as used for filters. */
export function renderChip(
	parentEl: HTMLElement,
	label: string,
	options: { icon?: string; active?: boolean; onClick: () => void },
): HTMLElement {
	const chip = parentEl.createEl("button", { cls: "semble-chip" });
	chip.toggleClass("is-active", Boolean(options.active));
	chip.setAttr("aria-pressed", String(Boolean(options.active)));
	if (options.icon) setIcon(chip.createSpan({ cls: "semble-chip-icon" }), options.icon);
	chip.createSpan({ text: label });
	chip.addEventListener("click", options.onClick);
	return chip;
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: { title: string; message: string; confirmText: string; onConfirm: () => void | Promise<void> },
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				button.setButtonText(this.options.confirmText).onClick(() => {
					this.close();
					void this.options.onConfirm();
				});
				button.buttonEl.addClass("mod-warning");
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
