import { DropdownComponent, moment } from "obsidian";
import { URL_TYPES, type Collection, type LibraryEntry, type UrlType, type UrlView } from "../api";
import { openUrl, plural, renderRow } from "../ui";
import { hostOf, sembleCollectionUrl, sembleProfileUrl } from "../urls";
import { PagedPanel } from "./context";

/** Related section: links Semble considers similar, optionally filtered by type. */
export class RelatedPanel extends PagedPanel<UrlView> {
	protected readonly emptyText = "No related links found.";
	private urlType: UrlType | "" = "";

	protected renderControls(): void {
		const types = Object.fromEntries(URL_TYPES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)]));
		new DropdownComponent(this.containerEl.createDiv({ cls: "semble-controls" }))
			.addOptions({ "": "All types", ...types })
			.setValue(this.urlType)
			.onChange((value) => {
				this.urlType = value as UrlType | "";
				void this.reset();
			});
	}

	protected async fetchPage(page: number) {
		const { urls, pagination } = await this.ctx.api.getSimilarUrls(this.ctx.link.url, {
			urlType: this.urlType || undefined,
			page,
			limit: 20,
		});
		return { items: urls, hasMore: pagination.hasMore };
	}

	protected renderItem(item: UrlView): void {
		renderRow(this.listEl, {
			icon: "globe",
			title: item.metadata.title || item.url,
			detail: hostOf(item.url) ?? undefined,
			flair: item.urlInLibrary ? "Saved" : undefined,
			tooltip: item.url,
			onClick: () => openUrl(item.url),
		});
	}
}

/** Saved by section: everyone with this link in their library. */
export class SavedByPanel extends PagedPanel<LibraryEntry> {
	protected readonly emptyText = "No one has saved this link yet.";

	protected async fetchPage(page: number) {
		const { libraries, pagination } = await this.ctx.api.getLibrariesForUrl(this.ctx.link.url, page);
		return { items: libraries, hasMore: pagination.hasMore };
	}

	protected renderItem({ user }: LibraryEntry): void {
		const url = sembleProfileUrl(user.handle);
		renderRow(this.listEl, {
			icon: "user",
			imageUrl: user.avatarUrl,
			title: user.name || user.handle,
			detail: `@${user.handle}`,
			tooltip: "Open profile on Semble",
			onClick: () => openUrl(url),
		});
	}
}

/** In collections section: collections containing this link. */
export class CollectionsPanel extends PagedPanel<Collection> {
	protected readonly emptyText = "Not in any collections yet.";

	protected async fetchPage(page: number) {
		const { collections, pagination } = await this.ctx.api.getCollectionsForUrl(this.ctx.link.url, page);
		return { items: collections, hasMore: pagination.hasMore };
	}

	protected renderItem(collection: Collection): void {
		const url = sembleCollectionUrl(collection.author.handle, collection.uri);
		const detail = [plural(collection.cardCount, "card"), `@${collection.author.handle}`];
		if (collection.updatedAt) detail.push(`updated ${moment(collection.updatedAt).fromNow()}`);
		renderRow(this.listEl, {
			icon: "folder",
			title: collection.name,
			detail: detail.join(" · "),
			tooltip: collection.description || undefined,
			onClick: url ? () => openUrl(url) : undefined,
		});
	}
}
