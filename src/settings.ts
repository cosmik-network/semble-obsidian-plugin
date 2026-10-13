import { App, PluginSettingTab, SecretComponent, Setting, type SettingDefinition } from "obsidian";
import { API_KEYS_URL } from "./api";
import { SEMBLE_ICON } from "./icon";
import type SemblePlugin from "./main";

export interface SembleSettings {
	/**
	 * Name of the secret in Obsidian's secret storage that holds the API key.
	 * The key itself is never written to data.json.
	 */
	apiKeySecret: string;
}

export const DEFAULT_SETTINGS: SembleSettings = {
	apiKeySecret: "",
};

type SettingKey = keyof SembleSettings;

export class SembleSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SemblePlugin,
	) {
		super(app, plugin);
		// Obsidian hides icons for community plugins in the settings sidebar, but
		// shows this one next to "Semble" in settings search results.
		this.icon = SEMBLE_ICON;
	}

	/**
	 * Declarative settings (Obsidian 1.13+): rendered by Obsidian and indexed by
	 * settings search. Also the single source for the legacy `display()` below.
	 */
	getSettingDefinitions(): SettingDefinition<SettingKey>[] {
		return [
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

		for (const def of this.getSettingDefinitions()) {
			const setting = new Setting(containerEl).setName(def.name);
			if (def.desc) setting.setDesc(def.desc);

			if ("action" in def && def.action) {
				const action = def.action;
				setting.addButton((button) => button.setButtonText(def.name).onClick(() => action(button.buttonEl, 0)));
			} else if ("control" in def && def.control?.type === "secret") {
				const { key } = def.control;
				setting.addComponent((el) =>
					new SecretComponent(this.app, el)
						.setValue(this.plugin.settings.apiKeySecret)
						.onChange((value) => this.setControlValue(key, value ?? "")),
				);
			}
		}
	}
}
