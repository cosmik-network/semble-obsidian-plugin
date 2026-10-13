import {
	App,
	PluginSettingTab,
	SecretComponent,
	Setting,
	type SettingDefinition,
	type SettingDefinitionGroup,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from "obsidian";
import { API_KEYS_URL } from "./api";
import type SemblePlugin from "./main";

export interface SembleSettings {
	/**
	 * Name of the secret in Obsidian's secret storage that holds the API key.
	 * The key itself is never written to data.json.
	 */
	apiKeySecret: string;
	includeImages: boolean;
	collapseDuplicates: boolean;
}

export const DEFAULT_SETTINGS: SembleSettings = {
	apiKeySecret: "",
	includeImages: true,
	collapseDuplicates: false,
};

type SettingKey = keyof SembleSettings;

export class SembleSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SemblePlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Declarative settings (Obsidian 1.13+): rendered by Obsidian and indexed by
	 * settings search. Also the single source for the legacy `display()` below.
	 */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				type: "group",
				heading: "Semble account",
				items: [
					{
						name: "API key",
						desc: createFragment((frag) => {
							frag.appendText("Create a key on your ");
							frag.createEl("a", { text: "Semble API keys page", href: API_KEYS_URL });
							frag.appendText(", then save it here as a secret.");
						}),
						control: { type: "secret", key: "apiKeySecret" },
					},
					{
						name: "Check connection",
						desc: "Confirm that Semble accepts the API key.",
						action: () => void this.plugin.checkConnection(),
					},
				],
			},
			{
				type: "group",
				heading: "Links pane",
				items: [
					{
						name: "Include images",
						desc: "List remote images, such as ![alt](https://…), alongside regular links.",
						control: { type: "toggle", key: "includeImages", defaultValue: DEFAULT_SETTINGS.includeImages },
					},
					{
						name: "Collapse duplicates",
						desc: "Show each URL once, with a count of how many times it is linked.",
						control: {
							type: "toggle",
							key: "collapseDuplicates",
							defaultValue: DEFAULT_SETTINGS.collapseDuplicates,
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	// Route writes through the plugin so open panes pick up the change.
	async setControlValue(key: string, value: unknown): Promise<void> {
		this.plugin.settings = { ...this.plugin.settings, [key]: value };
		await this.plugin.saveSettings();
	}

	/**
	 * Imperative fallback for Obsidian 1.11.4–1.13.1, which don't render
	 * getSettingDefinitions() (or its `secret` control). Newer versions never call this.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const item of this.getSettingDefinitions()) {
			if (isGroup(item)) {
				if (item.heading) new Setting(containerEl).setName(item.heading).setHeading();
				for (const child of item.items ?? []) {
					if (isDefinition(child)) this.renderLegacy(child);
				}
			} else if (isDefinition(item)) {
				this.renderLegacy(item);
			}
		}
	}

	private renderLegacy(def: SettingDefinition<SettingKey>): void {
		const setting = new Setting(this.containerEl).setName(def.name);
		if (def.desc) setting.setDesc(def.desc);

		if ("action" in def && def.action) {
			const action = def.action;
			setting.addButton((button) => button.setButtonText(def.name).onClick(() => action(button.buttonEl, 0)));
			return;
		}
		if (!("control" in def) || !def.control) return;

		const { control } = def;
		if (control.type === "secret") {
			setting.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.apiKeySecret)
					.onChange((value) => this.setControlValue(control.key, value ?? "")),
			);
		} else if (control.type === "toggle") {
			setting.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings[control.key] as boolean)
					.onChange((value) => this.setControlValue(control.key, value)),
			);
		}
	}
}

function isGroup(item: SettingDefinitionItem<SettingKey>): item is SettingDefinitionGroup<SettingKey> {
	return "type" in item && (item.type === "group" || item.type === "list");
}

/** A single setting row, as opposed to a group or a sub-page. */
function isDefinition(
	item: SettingDefinitionItem<SettingKey> | SettingGroupItem<SettingKey>,
): item is SettingDefinition<SettingKey> {
	return !isGroup(item) && !("items" in item);
}
