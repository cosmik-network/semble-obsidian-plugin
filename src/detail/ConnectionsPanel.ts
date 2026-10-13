import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	DropdownComponent,
	Menu,
	Notice,
	setIcon,
	TextAreaComponent,
} from "obsidian";
import { CONNECTION_TYPES, type Connection, type ConnectionType, type User } from "../api";
import type { WebLink } from "../links";
import { ConfirmModal, errorText, openUrl, renderMessage, renderRow } from "../ui";
import { hostOf, isHttpUrl, sameUrl } from "../urls";
import { Panel } from "./context";

const CONNECTION_LABELS: Record<ConnectionType, string> = {
	RELATED: "Related",
	SUPPORTS: "Supports",
	OPPOSES: "Opposes",
	ADDRESSES: "Addresses",
	HELPFUL: "Helpful",
	LEADS_TO: "Leads to",
	SUPPLEMENT: "Supplement",
	EXPLAINER: "Explainer",
	SAME_AS: "Same as",
	REFERENCES: "References",
};

function connectionLabel(type: string | undefined): string {
	if (!type) return "Connected";
	return CONNECTION_LABELS[type as ConnectionType] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Connections section: typed links between this URL and others, and a form to add one. */
export class ConnectionsPanel extends Panel {
	private me: User | null = null;
	private request = 0;

	protected async init(): Promise<void> {
		this.showList();
		// Only needed to offer "Delete" on the user's own connections.
		this.me = await this.ctx.api.getMyProfile().catch(() => null);
	}

	// --- List ---

	private showList(): void {
		const request = ++this.request;
		this.containerEl.empty();
		// First, and available right away, so adding a connection never waits on the list.
		renderRow(this.containerEl, { icon: "plus", title: "Add connection…", onClick: () => this.showCreate() });
		const listEl = this.containerEl.createDiv();
		const loadingEl = renderMessage(listEl, "Loading…");

		this.ctx.api
			.getConnections(this.ctx.link.url)
			.then(({ connections }) => {
				if (!this.alive || request !== this.request) return;
				loadingEl.remove();
				if (connections.length === 0) renderMessage(listEl, "No connections yet.");
				for (const connection of connections) this.renderConnection(listEl, connection);
			})
			.catch((err: unknown) => {
				if (!this.alive || request !== this.request) return;
				loadingEl.remove();
				renderMessage(listEl, errorText(err), () => this.showList());
			});
	}

	private renderConnection(parentEl: HTMLElement, item: Connection): void {
		const outgoing = !sameUrl(item.target.url, this.ctx.link.url);
		const other = outgoing ? item.target : item.source;
		const { connection } = item;

		// Compact row: title, then type, site and curator. Direction and note are in the tooltip.
		const direction = outgoing ? "This link → linked page" : "Linked page → this link";
		renderRow(parentEl, {
			title: other.metadata.title || other.url,
			detail: `${connectionLabel(connection.type)} · ${hostOf(other.url) ?? other.url} · @${connection.curator.handle}`,
			tooltip: [other.url, direction, connection.note].filter(Boolean).join("\n"),
			onClick: () => openUrl(other.url),
			onContextMenu: (evt) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle("Open link").setIcon("external-link").onClick(() => openUrl(other.url)));
				menu.addItem((i) =>
					i
						.setTitle("Copy URL")
						.setIcon("copy")
						.onClick(() => void navigator.clipboard.writeText(other.url)),
				);
				if (this.me && connection.curator.id === this.me.id) {
					menu.addSeparator();
					menu.addItem((i) =>
						i
							.setTitle("Delete connection")
							.setIcon("trash-2")
							.setWarning(true)
							.onClick(() => this.confirmDelete(connection.id, [item.source.url, item.target.url])),
					);
				}
				menu.showAtMouseEvent(evt);
			},
		});
	}

	private confirmDelete(connectionId: string, urls: string[]): void {
		new ConfirmModal(this.ctx.app, {
			title: "Delete connection?",
			message: "This permanently deletes the connection from Semble.",
			confirmText: "Delete",
			onConfirm: async () => {
				try {
					await this.ctx.api.deleteConnection(connectionId, urls);
					new Notice("Connection deleted");
					this.ctx.refresh();
				} catch (err) {
					new Notice(errorText(err));
				}
			},
		}).open();
	}

	// --- Create ---

	private showCreate(): void {
		++this.request;
		const { ctx } = this;
		this.containerEl.empty();
		const formEl = this.containerEl.createDiv({ cls: "semble-form" });

		let type: ConnectionType = "RELATED";
		let outgoing = true;
		let note = "";

		// This link, the connection type, and the other link, stacked in direction
		// order like the browser extension. The swap button flips the order.
		const stackEl = formEl.createDiv({ cls: "semble-connection-stack" });

		const thisEl = createDiv({ cls: "semble-connection-end" });
		const metadata = ctx.info()?.metadata;
		renderRow(thisEl, {
			title: metadata?.title || ctx.link.displayText,
			detail: hostOf(ctx.link.url) ?? ctx.link.url,
			thumbnailUrl: metadata?.imageUrl,
			flair: "This link",
		});

		const middleEl = createDiv({ cls: "semble-connection-middle" });
		setIcon(middleEl.createDiv({ cls: "semble-connection-arrow" }), "arrow-down");
		new DropdownComponent(middleEl)
			.addOptions(Object.fromEntries(CONNECTION_TYPES.map((t) => [t, CONNECTION_LABELS[t]])))
			.setValue(type)
			.onChange((value) => (type = value as ConnectionType));
		const swapEl = middleEl.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Swap direction" } });
		setIcon(swapEl, "arrow-up-down");

		const targetEl = createDiv({ cls: "semble-connection-end" });
		const inputEl = targetEl.createEl("input", {
			attr: { type: "text", placeholder: "Pick a link from this note or paste a URL", spellcheck: "false" },
		});
		if (ctx.otherNoteLinks().length === 0) {
			targetEl.createDiv({ cls: "semble-field-hint", text: "This note has no other web links." });
		}
		const suggest = new NoteLinkSuggest(ctx.app, inputEl, () => ctx.otherNoteLinks());
		suggest.onSelect((link) => {
			suggest.setValue(link.url);
			suggest.close();
			validate();
		});
		// Show the note's links as soon as the field is focused, not only after typing.
		inputEl.addEventListener("focus", () => inputEl.dispatchEvent(new Event("input")));
		inputEl.addEventListener("input", () => validate());

		const order = () => stackEl.append(...(outgoing ? [thisEl, middleEl, targetEl] : [targetEl, middleEl, thisEl]));
		swapEl.addEventListener("click", () => {
			outgoing = !outgoing;
			order();
		});
		order();

		new TextAreaComponent(formEl.createDiv({ cls: "semble-field" }))
			.setPlaceholder("Describe how these are related...")
			.onChange((value) => (note = value));

		const buttonsEl = formEl.createDiv({ cls: "semble-buttons" });
		new ButtonComponent(buttonsEl).setButtonText("Cancel").onClick(() => this.showList());
		const createButton = new ButtonComponent(buttonsEl).setButtonText("Add connection").setCta();

		const targetUrl = () => inputEl.value.trim();
		function validate(): void {
			const url = targetUrl();
			createButton.setDisabled(!isHttpUrl(url) || sameUrl(url, ctx.link.url));
		}
		validate();

		createButton.onClick(async () => {
			const other = targetUrl();
			createButton.setDisabled(true);
			try {
				await ctx.api.createConnection({
					sourceUrl: outgoing ? ctx.link.url : other,
					targetUrl: outgoing ? other : ctx.link.url,
					connectionType: type,
					note: note.trim() || undefined,
				});
				new Notice("Connection added");
				ctx.refresh();
			} catch (err) {
				new Notice(errorText(err));
				validate();
			}
		});

		inputEl.focus();
	}
}

/** Suggests the note's other web links for the connection's link field. */
class NoteLinkSuggest extends AbstractInputSuggest<WebLink> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly links: () => WebLink[],
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): WebLink[] {
		const q = query.trim().toLowerCase();
		return this.links().filter(
			(link) => !q || link.url.toLowerCase().includes(q) || link.displayText.toLowerCase().includes(q),
		);
	}

	renderSuggestion(link: WebLink, el: HTMLElement): void {
		el.createDiv({ text: link.displayText });
		if (link.displayText !== link.url) el.createDiv({ cls: "semble-suggestion-url", text: link.url });
	}
}
