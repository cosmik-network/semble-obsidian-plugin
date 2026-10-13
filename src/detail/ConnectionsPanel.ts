import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	DropdownComponent,
	Menu,
	Notice,
	TextAreaComponent,
} from "obsidian";
import { CONNECTION_TYPES, type Connection, type ConnectionType, type User } from "../api";
import type { WebLink } from "../links";
import { ConfirmModal, errorText, openUrl, renderField, renderMessage, renderRow } from "../ui";
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
		const listEl = this.containerEl.createDiv();
		const loadingEl = renderMessage(listEl, "Loading…");

		const addRow = () =>
			renderRow(listEl, { icon: "plus", title: "Add connection…", onClick: () => this.showCreate() });

		this.ctx.api
			.getConnections(this.ctx.link.url)
			.then(({ connections }) => {
				if (!this.alive || request !== this.request) return;
				loadingEl.remove();
				for (const connection of connections) this.renderConnection(listEl, connection);
				addRow();
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

		renderRow(parentEl, {
			icon: outgoing ? "arrow-right" : "arrow-left",
			title: other.metadata.title || other.url,
			detail: `${connectionLabel(connection.type)} · ${hostOf(other.url) ?? other.url} · @${connection.curator.handle}`,
			note: connection.note,
			tooltip: other.url,
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

		const linkField = renderField(formEl, "Link");
		const inputEl = linkField.createEl("input", {
			attr: { type: "text", placeholder: "Pick a link from this note or paste a URL", spellcheck: "false" },
		});
		if (ctx.otherNoteLinks().length === 0) {
			linkField.createDiv({ cls: "semble-field-hint", text: "This note has no other web links." });
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

		new DropdownComponent(renderField(formEl, "Type"))
			.addOptions(Object.fromEntries(CONNECTION_TYPES.map((t) => [t, CONNECTION_LABELS[t]])))
			.setValue(type)
			.onChange((value) => (type = value as ConnectionType));

		new DropdownComponent(renderField(formEl, "Direction"))
			.addOptions({ out: "From this link to the other", in: "From the other link to this one" })
			.setValue("out")
			.onChange((value) => (outgoing = value === "out"));

		new TextAreaComponent(renderField(formEl, "Note"))
			.setPlaceholder("Optional: how are these related?")
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
