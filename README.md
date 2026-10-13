# Semble for Obsidian

A sidebar pane that lists every web link (http/https URL) in the current note, the way the core **Outline** pane lists headings. Links to other notes are ignored.

- Finds `[text](https://…)` links, `<https://…>` links, bare `https://…` URLs, and remote images
- Skips anything that isn't a web link: `[[wikilinks]]`, `[text](note.md)`, `mailto:`, `obsidian://`, and URLs inside code or frontmatter
- Follows the note you're working on and updates as you type
- Click to open a link in your browser, or set it to jump to where the link appears in the note
- Right-click to open the link, jump to it in the note, or copy the URL
- A filter box, and an option to collapse duplicate URLs into one entry with a count

## Usage

Run **Semble: Show web links in current note** from the command palette, or click the globe icon in the ribbon. The pane opens in the right sidebar. You can drag it anywhere, like any other pane, and Obsidian remembers where you put it.

### Settings

| Setting             | Default       | Effect                                                                                                         |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| Click action        | Open the link | Whether a click opens the URL or jumps to the link's location in the note. Ctrl/Cmd-click always opens the URL |
| Include images      | On            | List remote images written as `![alt](https://…)`                                                              |
| Collapse duplicates | Off           | List each URL once, with a count of how many times it appears                                                  |

## Development

Requirements: Node 22+ and npm.

```sh
npm install
npm run dev      # watch mode: rebuilds main.js whenever you save a file
npm run build    # type-check, then make a minified production build
npm run lint     # ESLint with Obsidian's official rules (eslint-plugin-obsidianmd)
npm test         # unit tests for web link extraction (Vitest)
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
  main.ts       Plugin entry point: registers the view, command, ribbon icon and settings tab
  view.ts       LinksView (an ItemView): tracks the active note, renders the list, handles clicks and menus
  links.ts      Pure web link extraction: no runtime Obsidian imports, so it's unit tested in Node
  settings.ts   Settings interface, defaults and settings tab
tests/
  links.test.ts
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

### Obsidian best practices followed

- **Views:** the plugin never keeps references to its view. It looks them up with `getLeavesOfType()` and checks `instanceof LinksView`, because leaves can be deferred since 1.7. It doesn't detach leaves in `onunload()`, so the pane stays in place when the plugin is updated.
- **Cleanup:** every listener is attached with `registerEvent` / `register*`, so it's removed automatically when the view closes or the plugin unloads.
- **DOM:** the plugin builds elements with `createEl` / `createDiv`, never `innerHTML`. It reuses core `tree-item` classes and theme CSS variables, so the pane matches Outline and Backlinks in any theme.
- **Workspace API:** it uses `getActiveFile()`, `revealLeaf()` and `Keymap.isModEvent()` instead of `workspace.activeLeaf` or hand-rolled modifier-key checks. It opens URLs with `window.open()`, which Obsidian sends to the system browser, or to the Web viewer core plugin if that's enabled.
- **Settings:** settings are declared with `getSettingDefinitions()` (Obsidian 1.13+), which makes them show up in settings search. A `display()` fallback renders the same definitions on older versions. Labels use sentence case and the tab has no top-level heading.
- **Commands:** command IDs and names don't include the plugin name (Obsidian adds it as a prefix), and no hotkeys are assigned by default.
- **Mobile:** the plugin uses no Node or Electron APIs, so `isDesktopOnly` is `false`.
- **Linting:** `eslint-plugin-obsidianmd` checks the same guidelines that Obsidian's review uses for community plugin submissions.

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

## License

TBD. Add a `LICENSE` file before submitting to the community plugin directory.
