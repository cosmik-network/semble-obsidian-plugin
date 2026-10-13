import { URL_TYPES, type UrlType } from "../api";
import { errorText, openUrl, renderChip, renderMessage, renderUrlCard } from "../ui";
import { Panel } from "./context";

const PAGE_SIZE = 20;

/** "Related" tab: links Semble considers semantically similar, filterable by type. */
export class RelatedTab extends Panel {
	private urlType: UrlType | null = null;
	private page = 1;
	private request = 0;

	private chipsEl!: HTMLElement;
	private listEl!: HTMLElement;

	protected async init(): Promise<void> {
		this.containerEl.addClass("semble-related-tab");
		this.chipsEl = this.containerEl.createDiv({ cls: "semble-chips mod-scroll" });
		this.listEl = this.containerEl.createDiv({ cls: "semble-card-list" });
		this.renderChips();
		await this.loadPage(true);
	}

	private renderChips(): void {
		this.chipsEl.empty();
		const types: (UrlType | null)[] = [null, ...URL_TYPES];
		for (const type of types) {
			renderChip(this.chipsEl, type ? type[0]!.toUpperCase() + type.slice(1) : "All", {
				active: type === this.urlType,
				onClick: () => {
					if (type === this.urlType) return;
					this.urlType = type;
					this.renderChips();
					void this.loadPage(true);
				},
			});
		}
	}

	private async loadPage(reset: boolean): Promise<void> {
		const request = ++this.request;
		if (reset) {
			this.page = 1;
			this.listEl.empty();
		}
		this.listEl.querySelector(".semble-load-more")?.remove();
		const loadingEl = renderMessage(this.listEl, "Finding related links…");

		try {
			const { urls, pagination } = await this.ctx.api.getSimilarUrls(this.ctx.link.url, {
				urlType: this.urlType ?? undefined,
				page: this.page,
				limit: PAGE_SIZE,
			});
			if (!this.alive || request !== this.request) return;
			loadingEl.remove();

			if (urls.length === 0 && this.page === 1) {
				renderMessage(this.listEl, "No related links found.");
				return;
			}
			for (const item of urls) {
				renderUrlCard(this.listEl, item.metadata.url ? item.metadata : { ...item.metadata, url: item.url }, {
					badge: item.urlInLibrary ? "In library" : undefined,
					onClick: () => openUrl(item.url),
				});
			}
			if (pagination.hasMore) {
				const moreEl = this.listEl.createEl("button", { cls: "semble-load-more", text: "Load more" });
				moreEl.addEventListener("click", () => {
					this.page++;
					void this.loadPage(false);
				});
			}
		} catch (err) {
			if (!this.alive || request !== this.request) return;
			loadingEl.remove();
			renderMessage(this.listEl, errorText(err), () => void this.loadPage(reset));
		}
	}
}
