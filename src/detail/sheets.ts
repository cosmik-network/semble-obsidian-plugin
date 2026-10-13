import { Component, moment, setIcon } from "obsidian";
import type { Collection, LibraryEntry, Pagination, UrlCard, User } from "../api";
import { errorText, openUrl, plural, renderMessage } from "../ui";
import { hostOf, sembleCollectionUrl, sembleProfileUrl } from "../urls";
import type { DetailContext } from "./context";

/**
 * Bottom sheet over the links pane, like the browser extension's "Saved by"
 * and "In collections" overlays. Closes on ×, Escape, or a click on the backdrop.
 */
abstract class Sheet extends Component {
	protected alive = false;
	protected bodyEl!: HTMLElement;
	private rootEl!: HTMLElement;

	constructor(
		private readonly hostEl: HTMLElement,
		protected readonly ctx: DetailContext,
		private readonly title: string,
		private readonly onClose: () => void,
	) {
		super();
	}

	onload(): void {
		this.alive = true;
		this.rootEl = this.hostEl.createDiv({ cls: "semble-sheet-backdrop", attr: { tabindex: "-1" } });
		this.rootEl.addEventListener("click", (evt) => {
			if (evt.target === this.rootEl) this.onClose();
		});
		this.rootEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				evt.stopPropagation();
				this.onClose();
			}
		});

		const sheetEl = this.rootEl.createDiv({ cls: "semble-sheet", attr: { role: "dialog", "aria-label": this.title } });
		const headerEl = sheetEl.createDiv({ cls: "semble-sheet-header" });
		headerEl.createDiv({ cls: "semble-sheet-title", text: this.title });
		const closeEl = headerEl.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Close" } });
		setIcon(closeEl, "x");
		closeEl.addEventListener("click", () => this.onClose());

		this.bodyEl = sheetEl.createDiv({ cls: "semble-sheet-body" });
		this.rootEl.focus();
		void this.loadPage(1);
	}

	onunload(): void {
		this.alive = false;
		this.rootEl.remove();
	}

	/** Fetch and render one page of results, with a "Load more" button when there are more. */
	private async loadPage(page: number): Promise<void> {
		const loadingEl = renderMessage(this.bodyEl, "Loading…");
		try {
			const { items, pagination } = await this.fetchPage(page);
			if (!this.alive) return;
			loadingEl.remove();
			if (items.length === 0 && page === 1) renderMessage(this.bodyEl, this.emptyText);
			this.renderItems(items);
			if (pagination.hasMore) {
				const moreEl = this.bodyEl.createEl("button", { cls: "semble-load-more", text: "Load more" });
				moreEl.addEventListener("click", () => {
					moreEl.remove();
					void this.loadPage(page + 1);
				});
			}
		} catch (err) {
			if (!this.alive) return;
			loadingEl.remove();
			renderMessage(this.bodyEl, errorText(err), () => void this.loadPage(page));
		}
	}

	protected abstract emptyText: string;
	protected abstract fetchPage(page: number): Promise<{ items: unknown[]; pagination: Pagination }>;
	protected abstract renderItems(items: unknown[]): void;
}

/** "Saved by": everyone who has this link in their library. Click a user to open their Semble profile. */
export class SavedBySheet extends Sheet {
	protected emptyText = "No one has saved this link yet.";

	constructor(hostEl: HTMLElement, ctx: DetailContext, onClose: () => void) {
		super(hostEl, ctx, "Saved by", onClose);
	}

	protected async fetchPage(page: number) {
		const { libraries, pagination } = await this.ctx.api.getLibrariesForUrl(this.ctx.link.url, page);
		return { items: libraries, pagination };
	}

	protected renderItems(items: LibraryEntry[]): void {
		for (const { user } of items) {
			const rowEl = this.bodyEl.createEl("a", {
				cls: "semble-user",
				href: sembleProfileUrl(user.handle),
				attr: { "aria-label": `Open @${user.handle} on Semble` },
			});
			renderAvatar(rowEl, user);
			const textEl = rowEl.createDiv({ cls: "semble-user-text" });
			textEl.createDiv({ cls: "semble-user-name", text: user.name || user.handle });
			textEl.createDiv({ cls: "semble-user-handle", text: `@${user.handle}` });
		}
	}
}

/**
 * "In collections": collections containing this link, each with a strip of
 * its cards. Click a collection to open it on Semble, or a card to open its link.
 */
export class InCollectionsSheet extends Sheet {
	protected emptyText = "This link isn't in any collections yet.";
	private observer: IntersectionObserver | null = null;

	constructor(hostEl: HTMLElement, ctx: DetailContext, onClose: () => void) {
		super(hostEl, ctx, "In collections", onClose);
	}

	onunload(): void {
		this.observer?.disconnect();
		super.onunload();
	}

	protected async fetchPage(page: number) {
		const { collections, pagination } = await this.ctx.api.getCollectionsForUrl(this.ctx.link.url, page);
		return { items: collections, pagination };
	}

	protected renderItems(items: Collection[]): void {
		// Card previews cost a request per collection, so only fetch them as they scroll into view.
		this.observer ??= new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					this.observer?.unobserve(entry.target);
					(entry.target as HTMLElement).dispatchEvent(new Event("semble-load-preview"));
				}
			},
			{ root: this.bodyEl, rootMargin: "200px" },
		);
		for (const collection of items) this.renderCollection(collection);
	}

	private renderCollection(collection: Collection): void {
		const href = sembleCollectionUrl(collection.author.handle, collection.uri);
		const cardEl = this.bodyEl.createDiv({ cls: "semble-collection-card" });
		if (href) {
			cardEl.addClass("is-clickable");
			cardEl.setAttr("aria-label", "Open collection on Semble");
			cardEl.addEventListener("click", () => openUrl(href));
		}

		cardEl.createDiv({ cls: "semble-collection-card-title", text: collection.name });
		if (collection.description) cardEl.createDiv({ cls: "semble-card-desc", text: collection.description });

		const previewEl = cardEl.createDiv({ cls: "semble-preview-row" });
		previewEl.addEventListener("semble-load-preview", () => void this.loadPreview(collection.id, previewEl), {
			once: true,
		});
		this.observer?.observe(previewEl);

		const footerEl = cardEl.createDiv({ cls: "semble-collection-card-footer" });
		footerEl.createSpan({ text: `${plural(collection.cardCount, "card")} · @${collection.author.handle}` });
		if (collection.updatedAt) footerEl.createSpan({ text: `updated ${moment(collection.updatedAt).fromNow()}` });
	}

	private async loadPreview(collectionId: string, previewEl: HTMLElement): Promise<void> {
		try {
			const { urlCards } = await this.ctx.api.getCollection(collectionId);
			if (!this.alive) return;
			if (urlCards.length === 0) previewEl.remove();
			for (const card of urlCards) renderMiniCard(previewEl, card);
		} catch {
			// Previews are decoration; the collection itself is still listed.
			if (this.alive) previewEl.remove();
		}
	}
}

function renderAvatar(parentEl: HTMLElement, user: User): void {
	const avatarEl = parentEl.createDiv({ cls: "semble-avatar" });
	const initials = (user.name || user.handle).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase();
	if (!user.avatarUrl) {
		avatarEl.setText(initials);
		return;
	}
	const img = avatarEl.createEl("img", {
		attr: { src: user.avatarUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
	});
	img.addEventListener("error", () => {
		img.remove();
		avatarEl.setText(initials);
	});
}

function renderMiniCard(parentEl: HTMLElement, card: UrlCard): void {
	const { cardContent } = card;
	const el = parentEl.createDiv({ cls: "semble-mini-card", attr: { "aria-label": card.url } });
	const thumbEl = el.createDiv({ cls: "semble-mini-thumb" });
	if (cardContent.imageUrl) {
		const img = thumbEl.createEl("img", {
			attr: { src: cardContent.imageUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
		});
		img.addEventListener("error", () => {
			img.remove();
			setIcon(thumbEl, "globe");
		});
	} else {
		setIcon(thumbEl, "globe");
	}
	el.createDiv({ cls: "semble-mini-site", text: hostOf(card.url) ?? "" });
	el.createDiv({ cls: "semble-mini-title", text: cardContent.title || card.url });
	el.addEventListener("click", (evt) => {
		evt.stopPropagation(); // don't also open the collection
		openUrl(card.url);
	});
}
