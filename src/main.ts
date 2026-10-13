import { Notice, Plugin } from "obsidian";
import { SembleClient } from "./api";
import { registerIcons, SEMBLE_ICON } from "./icon";
import { DEFAULT_SETTINGS, SembleSettingTab, type SembleSettings } from "./settings";
import { LinksView, VIEW_TYPE_LINKS } from "./view";

export default class SemblePlugin extends Plugin {
	settings: SembleSettings = { ...DEFAULT_SETTINGS };
	readonly api = new SembleClient(() => this.getApiKey());

	async onload(): Promise<void> {
		await this.loadSettings();
		registerIcons();

		this.registerView(VIEW_TYPE_LINKS, (leaf) => new LinksView(leaf, this));

		this.addRibbonIcon(SEMBLE_ICON, "Show web links in current note", () => this.activateView());
		this.addCommand({
			id: "show-web-links",
			name: "Show web links in current note",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new SembleSettingTab(this.app, this));

		// Wait for the workspace to be restored, so an existing pane is found rather than duplicated.
		this.app.workspace.onLayoutReady(() => void this.addPaneOnFirstRun());
	}

	/**
	 * Put the pane in the right sidebar the first time the plugin runs, without
	 * switching to it, so its icon is there from the start. Obsidian keeps it
	 * in the workspace layout from then on; if the user closes it, it stays
	 * closed (the ribbon icon and command bring it back).
	 */
	private async addPaneOnFirstRun(): Promise<void> {
		if (this.settings.paneAdded) return;
		await this.app.workspace.ensureSideLeaf(VIEW_TYPE_LINKS, "right", { active: false, reveal: false });
		this.settings.paneAdded = true;
		await this.saveData(this.settings);
	}

	// Leaves are deliberately not detached on unload: Obsidian restores the pane
	// in place when the plugin is re-enabled or updated.

	/** Reveal the links pane, creating it in the right sidebar if it isn't open yet. */
	async activateView(): Promise<void> {
		await this.app.workspace.ensureSideLeaf(VIEW_TYPE_LINKS, "right", { active: true, reveal: true });
	}

	/** The API key from Obsidian's secret storage, or null if none is configured. */
	getApiKey(): string | null {
		const { apiKeySecret } = this.settings;
		return apiKeySecret ? this.app.secretStorage.getSecret(apiKeySecret) : null;
	}

	async checkConnection(): Promise<void> {
		this.api.invalidate({ methods: ["network.cosmik.actor.getMyProfile"] });
		try {
			const profile = await this.api.getMyProfile();
			new Notice(`Connected to Semble as @${profile.handle}`);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : "Couldn't connect to Semble.");
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<SembleSettings> | null;
		// Only keep known keys, so options removed in earlier versions drop out of data.json.
		this.settings = {
			apiKeySecret: data?.apiKeySecret ?? DEFAULT_SETTINGS.apiKeySecret,
			paneAdded: data?.paneAdded ?? DEFAULT_SETTINGS.paneAdded,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LINKS)) {
			// Deferred (not yet loaded) leaves render with fresh settings when first shown.
			if (leaf.view instanceof LinksView) leaf.view.onSettingsChanged();
		}
	}
}
