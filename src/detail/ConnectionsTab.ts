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
import { ConfirmModal, errorText, isHttpUrl, openUrl, renderMessage, renderUrlCard, sameUrl } from "../ui";
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

/** "Connections" tab: typed links between this URL and others, and a form to add one. */
export class ConnectionsTab extends Panel {
	private me: User | null = null;
	private request = 0;

	protected async init(): Promise<void> {
		this.containerEl.addClass("semble-connections-tab");
		this.showList();
		// Only needed to offer "Delete" on the user's own connections.
		this.me = await this.ctx.api.getMyProfile().catch(() => null);
	}

	// --- List ---

	private showList(): void {
		const request = ++this.request;
		this.containerEl.empty();
		const listEl = this.containerEl.createDiv({ cls: "semble-card-list" });
		const loadingEl = renderMessage(listEl, "Loading connections…");

		const footerEl = this.containerEl.createDiv({ cls: "semble-footer" });
		new ButtonComponent(footerEl)
			.setButtonText("Add connection")
			.setIcon("plus")
			.setCta()
			.onClick(() => this.showCreate())
			.buttonEl.addClass("semble-primary");

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
		const url = this.ctx.link.url;
		const outgoing = !sameUrl(item.target.url, url);
		const other = outgoing ? item.target : item.source;
		const { connection } = item;

		const el = parentEl.createDiv({ cls: "semble-connection" });
		const headEl = el.createDiv({ cls: "semble-connection-head" });
		const typeEl = headEl.createSpan({ cls: "semble-connection-type" });
		setIcon(typeEl.createSpan(), outgoing ? "arrow-right" : "arrow-left");
		typeEl.createSpan({ text: connectionLabel(connection.type) });
		typeEl.setAttr("aria-label", outgoing ? "From this link to the one below" : "From the link below to this one");
		headEl.createSpan({ cls: "semble-muted", text: `@${connection.curator.handle}` });

		renderUrlCard(el, other.metadata.url ? other.metadata : { ...other.metadata, url: other.url }, {
			onClick: () => openUrl(other.url),
		});
		if (connection.note) el.createDiv({ cls: "semble-connection-note", text: connection.note });

		el.addEventListener("contextmenu", (evt) => {
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
						.onClick(() => this.confirmDelete(connection.id)),
				);
			}
			menu.showAtMouseEvent(evt);
		});
	}

	private confirmDelete(connectionId: string): void {
		new ConfirmModal(this.ctx.app, {
			title: "Delete connection?",
			message: "This permanently deletes the connection from Semble.",
			confirmText: "Delete",
			onConfirm: async () => {
				try {
					await this.ctx.api.deleteConnection(connectionId);
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
		const formEl = this.containerEl.createDiv({ cls: "semble-connection-form" });

		let type: ConnectionType = "RELATED";
		let swapped = false;

		// This link, the connection type, and the other link, stacked in direction order.
		const stackEl = formEl.createDiv({ cls: "semble-connection-stack" });

		const thisEl = createDiv();
		const metadata = ctx.info()?.metadata;
		renderUrlCard(thisEl, { ...metadata, url: ctx.link.url, title: metadata?.title || ctx.link.displayText }, {
			badge: "This link",
		});

		const middleEl = createDiv({ cls: "semble-connection-middle" });
		new DropdownComponent(middleEl)
			.addOptions(Object.fromEntries(CONNECTION_TYPES.map((t) => [t, CONNECTION_LABELS[t]])))
			.setValue(type)
			.onChange((value) => (type = value as ConnectionType));
		const swapEl = middleEl.createEl("button", {
			cls: "semble-icon-button",
			attr: { "aria-label": "Swap direction" },
		});
		setIcon(swapEl, "arrow-up-down");
		setIcon(middleEl.createDiv({ cls: "semble-connection-arrow" }), "arrow-down");

		const targetEl = createDiv({ cls: "semble-connection-target" });
		const inputEl = targetEl.createEl("input", {
			cls: "semble-input",
			attr: { type: "text", placeholder: "Choose a link from this note or paste a URL", spellcheck: "false" },
		});
		const candidates = ctx.otherNoteLinks();
		if (candidates.length === 0) {
			targetEl.createDiv({ cls: "semble-muted", text: "This note has no other web links. Paste a URL instead." });
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

		const order = () => stackEl.append(...(swapped ? [targetEl, middleEl, thisEl] : [thisEl, middleEl, targetEl]));
		swapEl.addEventListener("click", () => {
			swapped = !swapped;
			order();
		});
		order();

		let note = "";
		new TextAreaComponent(formEl.createDiv({ cls: "semble-note" }))
			.setPlaceholder("Describe how these are related...")
			.onChange((value) => (note = value));

		const footerEl = formEl.createDiv({ cls: "semble-footer" });
		new ButtonComponent(footerEl).setButtonText("Cancel").onClick(() => this.showList());
		const createButton = new ButtonComponent(footerEl).setButtonText("Create").setCta();
		createButton.buttonEl.addClass("semble-primary");

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
					sourceUrl: swapped ? other : ctx.link.url,
					targetUrl: swapped ? ctx.link.url : other,
					connectionType: type,
					note: note.trim() || undefined,
				});
				new Notice("Connection created");
				ctx.refresh();
			} catch (err) {
				new Notice(errorText(err));
				validate();
			}
		});

		inputEl.focus();
	}
}

/** Dropdown of the note's other web links for the connection target field. */
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
		el.addClass("semble-suggestion");
		el.createDiv({ text: link.displayText });
		if (link.displayText !== link.url) el.createDiv({ cls: "semble-suggestion-url", text: link.url });
	}
}
