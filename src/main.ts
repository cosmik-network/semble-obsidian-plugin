import { Notice, Plugin } from "obsidian";
import { SembleClient } from "./api";
import { DEFAULT_SETTINGS, SembleSettingTab, type SembleSettings } from "./settings";
import { LinksView, VIEW_TYPE_LINKS } from "./view";

export default class SemblePlugin extends Plugin {
	settings: SembleSettings = { ...DEFAULT_SETTINGS };
	readonly api = new SembleClient(() => this.getApiKey());

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_LINKS, (leaf) => new LinksView(leaf, this));

		this.addRibbonIcon("globe", "Show web links in current note", () => this.activateView());
		this.addCommand({
			id: "show-web-links",
			name: "Show web links in current note",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new SembleSettingTab(this.app, this));
	}

	// Leaves are deliberately not detached on unload: Obsidian restores the pane
	// in place when the plugin is re-enabled or updated.

	/** Reveal the links pane, creating it in the right sidebar if it isn't open yet. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_LINKS)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_LINKS, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** The API key from Obsidian's secret storage, or null if none is configured. */
	getApiKey(): string | null {
		const { apiKeySecret } = this.settings;
		return apiKeySecret ? this.app.secretStorage.getSecret(apiKeySecret) : null;
	}

	async checkConnection(): Promise<void> {
		this.api.reset();
		try {
			const profile = await this.api.getMyProfile();
			new Notice(`Connected to Semble as @${profile.handle}`);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : "Couldn't connect to Semble.");
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<SembleSettings> | null) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.api.reset();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LINKS)) {
			// Deferred (not yet loaded) leaves render with fresh settings when first shown.
			if (leaf.view instanceof LinksView) leaf.view.onSettingsChanged();
		}
	}
}
