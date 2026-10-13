import { ButtonComponent, debounce, Notice, SearchComponent, setIcon, TextAreaComponent } from "obsidian";
import type { Collection, UrlCard } from "../api";
import { ConfirmModal, errorText, plural, renderChip, renderMessage } from "../ui";
import { Panel } from "./context";

type Source = "mine" | "recommended" | "open";

const SOURCES: { id: Source; label: string; icon: string }[] = [
	{ id: "mine", label: "My collections", icon: "folder" },
	{ id: "recommended", label: "Recommended", icon: "sparkles" },
	{ id: "open", label: "Open", icon: "sprout" },
];

/**
 * "Add" / "Update" tab: choose collections and write a note, then save the
 * link to (or update it in) the user's Semble library.
 */
export class LibraryTab extends Panel {
	private card: UrlCard | undefined;
	private initialSelected = new Set<string>();
	private selected = new Set<string>();
	private initialNote = "";
	private note = "";

	private source: Source = "mine";
	private query = "";
	private collections: Collection[] = [];
	/** Every collection seen so far, so selected ones can be shown even when filtered out. */
	private readonly known = new Map<string, Collection>();
	private recommended: Collection[] | null = null;
	private listRequest = 0;
	private busy = false;

	private chipsEl!: HTMLElement;
	private listEl!: HTMLElement;
	private saveButton!: ButtonComponent;

	private readonly searchLater = debounce(() => void this.loadCollections(), 300, true);

	protected async init(): Promise<void> {
		const loadingEl = renderMessage(this.containerEl, "Loading…");
		let status;
		try {
			status = await this.ctx.api.getLibraryStatus(this.ctx.link.url);
		} catch (err) {
			if (!this.alive) return;
			loadingEl.remove();
			renderMessage(this.containerEl, errorText(err), () => this.ctx.refresh());
			return;
		}
		if (!this.alive) return;
		loadingEl.remove();

		this.card = status.card;
		for (const collection of status.collections ?? []) {
			this.known.set(collection.id, collection);
			this.initialSelected.add(collection.id);
		}
		this.selected = new Set(this.initialSelected);
		this.initialNote = this.note = this.card?.note?.text ?? "";

		this.render();
		void this.loadCollections();
	}

	onunload(): void {
		this.searchLater.cancel();
		super.onunload();
	}

	private render(): void {
		const { containerEl } = this;
		containerEl.addClass("semble-library-tab");

		new SearchComponent(containerEl.createDiv({ cls: "semble-search" }))
			.setPlaceholder("Search or create a collection...")
			.onChange((value) => {
				this.query = value.trim();
				this.searchLater();
			});

		this.chipsEl = containerEl.createDiv({ cls: "semble-chips" });
		this.renderChips();

		this.listEl = containerEl.createDiv({ cls: "semble-collection-list" });

		new TextAreaComponent(containerEl.createDiv({ cls: "semble-note" }))
			.setPlaceholder("Add a note...")
			.setValue(this.note)
			.onChange((value) => {
				this.note = value;
				this.updateFooter();
			});

		const footerEl = containerEl.createDiv({ cls: "semble-footer" });
		if (this.card) {
			const removeEl = footerEl.createEl("button", {
				cls: "semble-icon-button mod-warning",
				attr: { "aria-label": "Remove from library" },
			});
			setIcon(removeEl, "trash-2");
			removeEl.addEventListener("click", () => this.confirmRemove());
		}
		new ButtonComponent(footerEl).setButtonText("Cancel").onClick(() => this.ctx.back());
		this.saveButton = new ButtonComponent(footerEl)
			.setButtonText(this.card ? "Update" : "Add to library")
			.setCta()
			.onClick(() => void this.save());
		this.saveButton.buttonEl.addClass("semble-primary");
		this.updateFooter();
	}

	private renderChips(): void {
		this.chipsEl.empty();
		for (const { id, label, icon } of SOURCES) {
			renderChip(this.chipsEl, label, {
				icon,
				active: id === this.source,
				onClick: () => {
					if (id === this.source) return;
					this.source = id;
					this.renderChips();
					void this.loadCollections();
				},
			});
		}
	}

	private async loadCollections(): Promise<void> {
		const request = ++this.listRequest;
		const { api, link } = this.ctx;
		this.listEl.empty();
		renderMessage(this.listEl, "Loading collections…");

		try {
			let collections: Collection[];
			if (this.source === "mine") {
				collections = (await api.listMyCollections(this.query)).collections;
			} else if (this.source === "open") {
				collections = (await api.searchOpenCollections(this.query)).collections;
			} else {
				if (!this.recommended) {
					const result = await api.getRecommendedCollections(link.url);
					this.recommended = [...result.myCollections, ...result.openCollections];
				}
				const query = this.query.toLowerCase();
				collections = this.recommended.filter((c) => !query || c.name.toLowerCase().includes(query));
			}
			if (!this.alive || request !== this.listRequest) return;

			for (const collection of collections) this.known.set(collection.id, collection);
			this.collections = collections;
			this.renderCollections();
		} catch (err) {
			if (!this.alive || request !== this.listRequest) return;
			this.listEl.empty();
			renderMessage(this.listEl, errorText(err), () => void this.loadCollections());
		}
	}

	private renderCollections(): void {
		this.listEl.empty();
		let items = this.collections;

		// Like the browser extension, list the link's current collections first.
		if (this.source === "mine" && !this.query) {
			const selected = [...this.selected].flatMap((id) => this.known.get(id) ?? []);
			items = [...selected, ...items.filter((c) => !this.selected.has(c.id))];
		}

		const canCreate =
			this.source === "mine" &&
			this.query.length > 0 &&
			!items.some((c) => c.name.toLowerCase() === this.query.toLowerCase());
		if (canCreate) this.renderCreateRow();
		if (items.length === 0 && !canCreate) {
			renderMessage(this.listEl, this.query ? "No collections match your search." : "No collections yet.");
		}

		for (const collection of items) this.renderCollection(collection);
	}

	private renderCollection(collection: Collection): void {
		const rowEl = this.listEl.createDiv({
			cls: "semble-collection",
			attr: { role: "checkbox", tabindex: "0" },
		});
		const textEl = rowEl.createDiv({ cls: "semble-collection-text" });
		textEl.createDiv({ cls: "semble-collection-name", text: collection.name });
		const meta = [plural(collection.cardCount, "card")];
		if (this.source !== "mine") meta.push(`@${collection.author.handle}`);
		textEl.createDiv({ cls: "semble-collection-meta", text: meta.join(" · ") });
		const checkEl = rowEl.createDiv({ cls: "semble-check" });

		const sync = () => {
			const isSelected = this.selected.has(collection.id);
			rowEl.toggleClass("is-selected", isSelected);
			rowEl.setAttr("aria-checked", String(isSelected));
			checkEl.empty();
			if (isSelected) setIcon(checkEl, "check");
		};
		const toggle = () => {
			if (this.selected.has(collection.id)) this.selected.delete(collection.id);
			else this.selected.add(collection.id);
			sync();
			this.updateFooter();
		};
		sync();
		rowEl.addEventListener("click", toggle);
		rowEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				toggle();
			}
		});
	}

	private renderCreateRow(): void {
		const name = this.query;
		const rowEl = this.listEl.createDiv({ cls: "semble-collection mod-create", attr: { tabindex: "0" } });
		setIcon(rowEl.createDiv({ cls: "semble-check" }), "plus");
		rowEl.createDiv({ cls: "semble-collection-name", text: `Create collection "${name}"` });

		const create = async () => {
			rowEl.addClass("is-disabled");
			try {
				const { collectionId } = await this.ctx.api.createCollection(name);
				new Notice(`Created collection "${name}"`);
				if (!this.alive) return;
				this.selected.add(collectionId);
				this.updateFooter();
				await this.loadCollections();
			} catch (err) {
				new Notice(errorText(err));
				rowEl.removeClass("is-disabled");
			}
		};
		rowEl.addEventListener("click", () => void create());
		rowEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") void create();
		});
	}

	private isDirty(): boolean {
		if (this.note !== this.initialNote) return true;
		if (this.selected.size !== this.initialSelected.size) return true;
		return [...this.selected].some((id) => !this.initialSelected.has(id));
	}

	private updateFooter(): void {
		// A new link can be saved as-is; an existing one only when something changed.
		this.saveButton?.setDisabled(this.busy || (Boolean(this.card) && !this.isDirty()));
	}

	private async save(): Promise<void> {
		const { api, link } = this.ctx;
		this.busy = true;
		this.updateFooter();
		try {
			if (!this.card) {
				await api.addUrl({
					url: link.url,
					note: this.note.trim() || undefined,
					collectionIds: [...this.selected],
				});
				new Notice("Added to your Semble library");
			} else {
				const added = [...this.selected].filter((id) => !this.initialSelected.has(id));
				const removed = [...this.initialSelected].filter((id) => !this.selected.has(id));
				await api.updateUrlAssociations({
					cardId: this.card.id,
					note: this.note !== this.initialNote ? this.note : undefined,
					addToCollections: added.length ? added : undefined,
					removeFromCollections: removed.length ? removed : undefined,
				});
				new Notice("Updated in your Semble library");
			}
			this.ctx.refresh();
		} catch (err) {
			new Notice(errorText(err));
			this.busy = false;
			this.updateFooter();
		}
	}

	private confirmRemove(): void {
		const card = this.card;
		if (!card) return;
		new ConfirmModal(this.ctx.app, {
			title: "Remove from library?",
			message: "This removes the link from your Semble library and from your collections.",
			confirmText: "Remove",
			onConfirm: async () => {
				try {
					await this.ctx.api.removeFromLibrary(card.id);
					new Notice("Removed from your Semble library");
					this.ctx.refresh();
				} catch (err) {
					new Notice(errorText(err));
				}
			},
		}).open();
	}
}
