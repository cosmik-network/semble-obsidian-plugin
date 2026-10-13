import { App, PluginSettingTab, Setting, type SettingDefinition } from "obsidian";
import type SemblePlugin from "./main";

export type ClickAction = "open" | "reveal";

export interface SembleSettings {
	/** What a plain click on a link in the pane does. */
	clickAction: ClickAction;
	includeImages: boolean;
	collapseDuplicates: boolean;
}

export const DEFAULT_SETTINGS: SembleSettings = {
	clickAction: "open",
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
	getSettingDefinitions(): SettingDefinition<SettingKey>[] {
		return [
			{
				name: "Click action",
				desc: "What happens when you click a link in the links pane. Right-click a link for the other actions.",
				control: {
					type: "dropdown",
					key: "clickAction",
					defaultValue: DEFAULT_SETTINGS.clickAction,
					options: { open: "Open the link", reveal: "Jump to the link in the note" },
				},
			},
			{
				name: "Include images",
				desc: "List remote images, such as ![alt](https://…), alongside regular links.",
				control: { type: "toggle", key: "includeImages", defaultValue: DEFAULT_SETTINGS.includeImages },
			},
			{
				name: "Collapse duplicates",
				desc: "Show each URL once, with a count of how many times it is linked.",
				control: { type: "toggle", key: "collapseDuplicates", defaultValue: DEFAULT_SETTINGS.collapseDuplicates },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	// Route writes through the plugin so open links panes re-render.
	async setControlValue(key: string, value: unknown): Promise<void> {
		this.plugin.settings = { ...this.plugin.settings, [key]: value };
		await this.plugin.saveSettings();
	}

	/**
	 * Imperative fallback for Obsidian < 1.13, which doesn't know about
	 * getSettingDefinitions(). Newer versions never call this.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const def of this.getSettingDefinitions()) {
			if (!("control" in def) || !def.control) continue;
			const { control } = def;
			const setting = new Setting(containerEl).setName(def.name);
			if (def.desc) setting.setDesc(def.desc);

			if (control.type === "toggle") {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings[control.key] as boolean)
						.onChange((value) => this.setControlValue(control.key, value)),
				);
			} else if (control.type === "dropdown") {
				setting.addDropdown((dropdown) =>
					dropdown
						.addOptions(control.options)
						.setValue(this.plugin.settings[control.key] as string)
						.onChange((value) => this.setControlValue(control.key, value)),
				);
			}
		}
	}
}
