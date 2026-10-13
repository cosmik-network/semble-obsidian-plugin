import { ButtonComponent, debounce, Notice, SearchComponent, TextAreaComponent } from "obsidian";
import type { Collection, UrlCard } from "../api";
import { ConfirmModal, errorText, renderMessage, renderRow, renderToggleGroup } from "../ui";
import { Panel } from "./context";

type Source = "mine" | "recommended" | "open";

const SOURCES: { id: Source; label: string }[] = [
	{ id: "mine", label: "My collections" },
	{ id: "recommended", label: "Recommended" },
	{ id: "open", label: "Open" },
];

/** Library section: pick collections, write a note, and save the link to Semble. */
export class LibraryPanel extends Panel {
	private card: UrlCard | undefined;
	private initialSelected = new Set<string>();
	private selected = new Set<string>();
	private initialNote = "";
	private note = "";

	private source: Source = "mine";
	private query = "";
	private collections: Collection[] = [];
	/** Every collection seen so far, so selected ones stay listed even when filtered out. */
	private readonly known = new Map<string, Collection>();
	private recommended: Collection[] | null = null;
	private listRequest = 0;
	private busy = false;

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

		new SearchComponent(containerEl.createDiv({ cls: "semble-controls" }))
			.setPlaceholder("Search or create a collection...")
			.onChange((value) => {
				this.query = value.trim();
				this.searchLater();
			});
		renderToggleGroup(
			containerEl,
			SOURCES,
			this.source,
			(id) => {
				this.source = id;
				void this.loadCollections();
			},
			"semble-filters",
		);

		this.listEl = containerEl.createDiv({ cls: "semble-collection-list" });

		new TextAreaComponent(containerEl.createDiv({ cls: "semble-field" }))
			.setPlaceholder("Add a note...")
			.setValue(this.note)
			.onChange((value) => {
				this.note = value;
				this.updateButtons();
			});

		const buttonsEl = containerEl.createDiv({ cls: "semble-buttons" });
		if (this.card) {
			new ButtonComponent(buttonsEl)
				.setButtonText("Remove")
				.setTooltip("Remove from your Semble library")
				.onClick(() => this.confirmRemove())
				.buttonEl.addClass("mod-warning");
		}
		this.saveButton = new ButtonComponent(buttonsEl)
			.setButtonText(this.card ? "Update" : "Add to library")
			.setCta()
			.onClick(() => void this.save());
		this.updateButtons();
	}

	private async loadCollections(): Promise<void> {
		const request = ++this.listRequest;
		const { api, link } = this.ctx;
		this.listEl.empty();
		renderMessage(this.listEl, "Loading…");

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

		// List the link's current collections first.
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
			renderMessage(this.listEl, this.query ? "No collections match." : "No collections yet.");
		}
		for (const collection of items) this.renderCollection(collection);
	}

	/** A `<label>` row around a native checkbox: clicking anywhere on it toggles the box. */
	private renderCollection(collection: Collection): void {
		const itemEl = this.listEl.createDiv({ cls: "tree-item semble-row" });
		const rowEl = itemEl.createEl("label", { cls: "tree-item-self is-clickable" });
		const checkbox = rowEl.createEl("input", { type: "checkbox" });
		checkbox.checked = this.selected.has(collection.id);
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) this.selected.add(collection.id);
			else this.selected.delete(collection.id);
			this.updateButtons();
		});

		const innerEl = rowEl.createDiv({ cls: "tree-item-inner" });
		innerEl.createDiv({ cls: "semble-row-title", text: collection.name });
		if (this.source !== "mine") {
			innerEl.createDiv({ cls: "semble-row-detail", text: `@${collection.author.handle}` });
		}
		rowEl
			.createDiv({ cls: "tree-item-flair-outer" })
			.createSpan({ cls: "tree-item-flair", text: String(collection.cardCount) });
		if (collection.description) rowEl.setAttr("aria-label", collection.description);
	}

	private renderCreateRow(): void {
		const name = this.query;
		const rowEl = renderRow(this.listEl, {
			icon: "plus",
			title: `Create "${name}"`,
			onClick: () => void create(),
		});

		const create = async () => {
			rowEl.addClass("is-disabled");
			try {
				const { collectionId } = await this.ctx.api.createCollection(name);
				new Notice(`Created collection "${name}"`);
				if (!this.alive) return;
				this.selected.add(collectionId);
				this.updateButtons();
				await this.loadCollections();
			} catch (err) {
				new Notice(errorText(err));
				rowEl.removeClass("is-disabled");
			}
		};
	}

	/** Not while the user has unsaved changes, a search, or another collection source showing. */
	canRefresh(): boolean {
		return !this.busy && !this.isDirty() && !this.query && this.source === "mine";
	}

	private isDirty(): boolean {
		if (this.note !== this.initialNote) return true;
		if (this.selected.size !== this.initialSelected.size) return true;
		return [...this.selected].some((id) => !this.initialSelected.has(id));
	}

	private updateButtons(): void {
		// A new link can be saved as-is; an existing one only when something changed.
		this.saveButton?.setDisabled(this.busy || (Boolean(this.card) && !this.isDirty()));
	}

	private async save(): Promise<void> {
		const { api, link } = this.ctx;
		this.busy = true;
		this.updateButtons();
		try {
			if (!this.card) {
				await api.addUrl({
					url: link.url,
					note: this.note.trim() || undefined,
					collectionIds: [...this.selected],
				});
				new Notice("Saved to your Semble library");
			} else {
				const added = [...this.selected].filter((id) => !this.initialSelected.has(id));
				const removed = [...this.initialSelected].filter((id) => !this.selected.has(id));
				await api.updateUrlAssociations(link.url, {
					cardId: this.card.id,
					note: this.note !== this.initialNote ? this.note : undefined,
					addToCollections: added.length ? added : undefined,
					removeFromCollections: removed.length ? removed : undefined,
				});
				new Notice("Saved changes to Semble");
			}
			this.ctx.refresh();
		} catch (err) {
			new Notice(errorText(err));
			this.busy = false;
			this.updateButtons();
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
					await this.ctx.api.removeFromLibrary(this.ctx.link.url, card.id);
					new Notice("Removed from your Semble library");
					this.ctx.refresh();
				} catch (err) {
					new Notice(errorText(err));
				}
			},
		}).open();
	}
}
