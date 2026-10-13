# Semble for Obsidian

A sidebar pane that lists every web link (http/https URL) in the current note, the way the core **Outline** pane lists headings. Click a link to see it on [Semble](https://semble.so): save it to your library and collections, browse related links, and connect it to other links. Links to other notes are ignored.

- Finds `[text](https://…)` links, `<https://…>` links, bare `https://…` URLs, and remote images
- Skips anything that isn't a web link: `[[wikilinks]]`, `[text](note.md)`, `mailto:`, `obsidian://`, and URLs inside code or frontmatter
- Follows the note you're working on and updates as you type
- Click a link to open its Semble view; Ctrl/Cmd-click opens it in your browser
- Right-click to open the link, jump to it in the note, or copy the URL
- A filter box, and an option to collapse duplicate URLs into one entry with a count

## Usage

Run **Semble: Show web links in current note** from the command palette, or click the globe icon in the ribbon. The pane opens in the right sidebar. You can drag it anywhere, like any other pane, and Obsidian remembers where you put it.

### Connecting Semble

1. Create an API key at [semble.so/settings/api-keys](https://semble.so/settings/api-keys).
2. In **Settings → Semble**, set **API key** to a secret that contains the key. You can create the secret from that field.
3. Use **Check connection** to confirm it works. You should see "Connected to Semble as @your-handle".

The key is kept in Obsidian's secret storage, not in the plugin's `data.json`, so it doesn't end up in synced or committed vault files.

### The link view

Clicking a link in the list opens a view for that link, laid out like Semble's browser extension. The header shows the site, title, description, thumbnail, an **In library** badge, and counts of saves, collections and connections. The counts are clickable:

- **Saves** opens a *Saved by* sheet listing everyone who saved the link. Click a person to open their Semble profile, `semble.so/profile/<handle>`.
- **Collections** opens an *In collections* sheet. Each collection shows its description, a strip of its cards, its card count and when it was last updated. Click a collection to open it on Semble, at `semble.so/profile/<owner handle>/collections/<rkey>`, where `rkey` is the last segment of the collection's AT URI. Click a card to open its link.
- **Connections** switches to the Connections tab.

Sheets close with ×, Escape, or a click outside them. The back arrow returns to the list. The icons next to it reload the link's data from Semble, jump to the link in the note, or open it in your browser. Links reopen on the tab you last used. There are three tabs:

- **Add / Update**: choose collections and write a note, then **Add to library**, or **Update** if the link is already saved. You can switch the collection list between **My collections**, **Recommended** (collections with similar links) and **Open** (collections anyone can add to). The search box filters the list. If no collection matches, it offers to create one with that name. The trash button removes the link from your library.
- **Related**: links that Semble considers similar, filtered by type (article, book, video, and so on). Click one to open it.
- **Connections**: typed connections between this link and others, such as *Supports*, *Opposes* or *Related*. Arrows show the direction. Click a connection to open the other link. Right-click one of your own connections to delete it. **Add connection** opens a form. The target field lists the other web links in the current note, and you can also paste any URL. Choose a connection type, use the swap button to reverse the direction, add an optional note, and select **Create**.

### Settings

| Setting             | Default | Effect                                                                     |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| API key             | None    | The secret that holds your Semble API key                                  |
| Check connection    | —       | Calls Semble with the key and shows which account it belongs to            |
| Include images      | On      | List remote images written as `![alt](https://…)`                          |
| Collapse duplicates | Off     | List each URL once, with a count of how many times it appears              |

## Development

Requirements: Node 22+ and npm.

```sh
npm install
npm run dev      # watch mode: rebuilds main.js whenever you save a file
npm run build    # type-check, then make a minified production build
npm run lint     # ESLint with Obsidian's official rules (eslint-plugin-obsidianmd)
npm test         # unit tests (Vitest): link extraction, API client, URL helpers
```

### Trying it in a vault

Use a separate test vault, not your real one. Link the repo into the vault's plugin folder; the folder name must match the `id` in `manifest.json`:

```sh
ln -s "$(pwd)" /path/to/test-vault/.obsidian/plugins/semble
```

Then in Obsidian go to **Settings → Community plugins**, turn on community plugins, and enable **Semble**. With `npm run dev` running, use the **Reload app without saving** command to pick up changes, or install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin to reload automatically.

### Project layout

```
src/
  main.ts                 Plugin entry point: registers the view, command, ribbon icon and settings tab; owns the API client
  view.ts                 LinksView (an ItemView): tracks the active note, renders the list, swaps in the link view
  links.ts                Pure web link extraction: no runtime Obsidian imports, so it's unit tested in Node
  api.ts                  Typed Semble API client built on Obsidian's requestUrl
  settings.ts             Settings interface, defaults and settings tab (API key secret, pane options)
  ui.ts                   Shared UI helpers: URL cards, filter chips, confirm modal
  urls.ts                 Pure URL helpers: host names, validation, Semble-style URL comparison
  detail/
    LinkDetail.ts         The link view: navigation bar, header with metadata and stats, tab switching
    context.ts            DetailContext shared by the tabs, and the Panel base class
    LibraryTab.ts         Add / Update: collections, note, save and remove
    RelatedTab.ts         Related links, filtered by type
    ConnectionsTab.ts     Connection list and the create-connection form
    sheets.ts             "Saved by" and "In collections" bottom sheets opened from the stats
tests/
  links.test.ts  api.test.ts  urls.test.ts
styles.css      Pane styles; Obsidian loads this automatically
manifest.json   Plugin metadata read by Obsidian
versions.json   Maps each plugin version to its minimum Obsidian version
```

### How it works

**Finding links.** Obsidian's metadata cache doesn't record external links, so `extractLinks(content, cache)` scans the note text. Before scanning, it blanks out the regions that can't contain web links: code blocks, inline code, math blocks, frontmatter, and internal links. It gets the internal link positions from the metadata cache, so a URL used as alias text, like `[[Note|https://…]]`, isn't listed. Blanking replaces characters with spaces, so offsets and line numbers still match the original text. Markdown links come first, then `<autolinks>`, then bare URLs. Each pass blanks what it matched so the next pass can't count the same link twice. Only `http://` and `https://` URLs are kept.

Links are listed in the order they appear in the note. Each link keeps its `Pos` (line, column, offset), which **Jump to link in note** uses to select the link's text.

**Tracking the note.** Like Outline, the pane shows the most recently *opened* file, not whichever pane has focus. So when you click into the sidebar, it keeps showing your note. The view listens to these events:

| Event                    | Reaction                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `workspace:file-open`    | Switch to the new file                                                                               |
| `metadataCache:changed`  | Re-extract links, debounced, if it's our file. This fires after edits, so the pane updates as you type |
| `vault:delete`           | Clear the pane if our file was deleted                                                               |

`refresh()` reads the file asynchronously, so each call takes an ID first. If a newer refresh has started by the time the read finishes, the older result is thrown away.

**The link view.** `LinksView` keeps the list in the DOM and hides it while a link is open, so the filter and scroll position survive going back. `LinkDetail` is a `Component` added as a child of the view. Each tab is also a child `Component`, a subclass of `Panel`, so switching tabs, going back, or closing the pane unloads it and its listeners. Tabs load data asynchronously and check an `alive` flag, plus a request counter where a request can be repeated, before rendering. This drops responses that arrive after you've moved on. Switching to another note returns to the list, and changing settings rebuilds an open link view.

**Semble API.** `SembleClient` (`src/api.ts`) calls `https://api.semble.so/xrpc/<method>` with the key in the `x-api-key` header and `X-Semble-Client: obsidian` to identify the integration. It reads the key on every request, so a key change takes effect immediately.

**Caching.** GET responses are cached in memory for 5 minutes, keyed by method and query. Going back to the list and reopening a link, or switching between its tabs, renders from the cache without any loading state. The client caches the promise, not just the result, so identical requests that are already in flight are shared. Failed requests are never cached. Each mutation clears what it makes stale:

- Adding, updating or removing a library card clears that URL's entries and the collection lists.
- Creating a collection clears the collection lists.
- Creating or deleting a connection clears entries for both of its URLs.

Entries are matched with `sameUrl()`, so normalized URLs still match. A different API key clears the whole cache. The reload button in the link view clears the link's entries so changes made elsewhere, such as on semble.so, show up straight away. 401 and 403 responses turn into a "check your API key" message, and other errors show the API's own `message`. The endpoints used:

| Where                     | Endpoints                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Header                    | `card.getUrlMetadata` (with `includeStats`)                                                                  |
| Stat sheets               | `card.getLibrariesForUrl` (Saved by), `collection.getForUrl` and `collection.get` (card previews, fetched as each collection scrolls into view) |
| Add / Update              | `card.getLibraryStatus`, `collection.listMine`, `collection.getRecommendedForUrl`, `collection.search` (open), `collection.create`, `card.addUrl`, `card.updateUrlAssociations`, `card.removeFromLibrary` |
| Related                   | `search.getSimilarUrls`                                                                                      |
| Connections               | `connection.getForUrl` (both directions), `connection.create`, `connection.delete`, `actor.getMyProfile` (to know which connections are yours) |
| Settings                  | `actor.getMyProfile` (Check connection)                                                                      |

Semble normalizes URLs, for example `https://semble.so` becomes `https://semble.so/`, so the plugin compares URLs with `sameUrl()` rather than `===`.

### Obsidian best practices followed

- **Views:** the plugin never keeps references to its view. It looks them up with `getLeavesOfType()` and checks `instanceof LinksView`, because leaves can be deferred since 1.7. It doesn't detach leaves in `onunload()`, so the pane stays in place when the plugin is updated.
- **Cleanup:** every listener is attached with `registerEvent` / `register*`, so it's removed automatically when the view closes or the plugin unloads.
- **DOM:** the plugin builds elements with `createEl` / `createDiv`, never `innerHTML`. It reuses core `tree-item` classes and theme CSS variables, so the pane matches Outline and Backlinks in any theme.
- **Workspace API:** it uses `getActiveFile()`, `revealLeaf()` and `Keymap.isModEvent()` instead of `workspace.activeLeaf` or hand-rolled modifier-key checks. It opens URLs with `window.open()`, which Obsidian sends to the system browser, or to the Web viewer core plugin if that's enabled.
- **Settings:** settings are declared with `getSettingDefinitions()` (Obsidian 1.13+), which makes them show up in settings search. A `display()` fallback renders the same definitions on older versions. Labels use sentence case.
- **Secrets:** the API key lives in `app.secretStorage` (Obsidian 1.11.4+). The settings only store the secret's name. This is why `minAppVersion` is 1.11.4.
- **Network:** requests go through `requestUrl`, not `fetch`. It isn't subject to CORS and works on mobile.
- **Commands:** command IDs and names don't include the plugin name (Obsidian adds it as a prefix), and no hotkeys are assigned by default.
- **Mobile:** the plugin uses no Node or Electron APIs, so `isDesktopOnly` is `false`.
- **Linting:** `eslint-plugin-obsidianmd` checks the same guidelines that Obsidian's review uses for community plugin submissions. This includes flagging APIs newer than `minAppVersion`. "Semble" is added to the sentence-case rule's `ignoreWords` because it's a product name.

### Releasing

1. `npm version patch|minor|major`. This updates `manifest.json` and `versions.json` through `version-bump.mjs`.
2. `git push --follow-tags`. The tag must match the manifest version exactly, with no `v` prefix.
3. `.github/workflows/release.yml` lints, tests, builds, and creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css` attached. Review it and publish it.

If you raise `minAppVersion`, update it in `manifest.json` before you run `npm version`.

## Known limitations

- Only Markdown notes are scanned. Canvas files and PDFs show an empty state.
- URLs in frontmatter properties aren't listed.
- Reference-style links (`[text][ref]` with `[ref]: https://…` defined elsewhere) show up as a bare URL at the line where `[ref]` is defined, not where `[text][ref]` is used, and without the link text.
- `www.example.com` without `https://` isn't detected.
- The link view's collection list shows up to 100 of your collections. Use the search box to find others.
- Connections are listed 50 at a time, newest first, with no paging yet.

## License

TBD. Add a `LICENSE` file before submitting to the community plugin directory.
