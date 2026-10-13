# Semble for Obsidian

See every web link in your note at a glance, and work with them on [Semble](https://semble.so) without leaving Obsidian.

The plugin adds a pane to the sidebar that lists the web links in the note you're working on, the way **Outline** lists headings. Click a link to save it to your Semble library and collections, browse related links, and connect it to other links.

## Getting started

### Install

Until the plugin is in Obsidian's community plugin directory, install it manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases).
2. Put them in a folder called `semble` inside your vault's `.obsidian/plugins/` folder.
3. In Obsidian, open **Settings → Community plugins**, turn on community plugins if needed, and enable **Semble**.

### Connect your Semble account

1. Create an API key on your [Semble API keys page](https://semble.so/settings/api-keys).
2. In **Settings → Semble**, set **API key** to a secret that contains your key. You can create the secret right from that field.
3. Click **Check connection**. You should see "Connected to Semble as @your-handle".

Your key is stored in Obsidian's Keychain, not in the plugin's settings file, so it isn't copied around when you sync your vault.

### Open the pane

Click the Semble icon (a stack of stones) in the ribbon, or run **Semble: Show web links in current note** from the command palette. The pane opens in the right sidebar. You can move it anywhere, like any other pane.

## The link list

The pane follows the note you're working on and updates as you type. It lists:

- links like `[text](https://…)` and `<https://…>`
- plain `https://…` URLs
- remote images

It skips links to other notes, `mailto:` and `obsidian://` links, and anything inside code or frontmatter.

- **Save counts:** the number on the right is how many people have saved the link on Semble. It shows in your accent colour with a checkmark if the link is in your library, and doesn't show at all if no one has saved it.
- **Filter:** use the box at the top to narrow the list.
- **Click** a link to open its Semble view (below).
- **Ctrl/Cmd-click** opens the link on Semble.
- **Right-click** to open it on Semble, jump to where it is in the note, or copy the URL.

Links open on their Semble page (`semble.so/url?id=…`) rather than on the site itself. Links to Semble collections open directly.

## The link view

Clicking a link shows it as it is on Semble:

- **Toolbar:** go back to the list, jump to the link in your note, or open it on Semble.
- **Header:** the site, the title and description, and a checkmark if it's in your library.
- **Stats:** how many saves, collections and connections it has. Click **saves** to see who saved it, or **collections** to see which collections it's in. Click a person or a collection to open them on Semble. Click **connections** to go to the Connections tab.

Below the header are three tabs. Each link opens on the tab you used last.

- **Add:** pick collections and add a note, then click **Add to library**. If the link is already saved, click **Update** after making changes, or **Remove** to take it out of your library.
    - Switch between **My collections**, **Recommended** (collections with similar links) and **Open** (collections anyone can add to).
    - Search for a collection by name. If none matches, you can create one with that name.
- **Related:** links Semble considers similar, with their save counts. Filter by type, such as article, book or video.
- **Connections:** how this link relates to others, such as _Supports_, _Opposes_ or _Related_. Hover a connection to see its direction and note. Right-click one of your own connections to delete it.
    - **Add connection…** at the top opens a form. Choose the other link from the other links in your note, or paste any URL.
    - Pick the type of connection. Use the swap button to change its direction.
    - Add an optional note.

Everything opens instantly once it has been loaded. The plugin quietly checks Semble in the background and updates anything that changed, so changes you make on semble.so show up too.

## Settings

| Setting          | What it does                                             |
| ---------------- | -------------------------------------------------------- |
| API key          | The secret in Obsidian's Keychain that holds your key    |
| Check connection | Checks the key with Semble and shows which account it is |

## Known limitations

- Only Markdown notes are scanned. Canvas files and PDFs show an empty list.
- URLs in a note's properties (frontmatter) aren't listed.
- Reference-style links (`[text][ref]` with `[ref]: https://…` elsewhere) are listed as a plain URL, at the line where `[ref]` is defined.
- `www.example.com` without `https://` isn't detected.
- The **Add** tab shows up to 100 of your collections. Search to find others.
- The Connections tab shows the 50 most recent connections.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, how the plugin works, and releasing.

## License

TBD.
