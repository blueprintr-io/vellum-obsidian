# Vellum for Obsidian

Draw diagrams in Obsidian with [Vellum](https://github.com/blueprintr-io/vellum-editor):
architecture, process and software diagrams, freehand notes, UML, BPMN,
flowcharts and rack diagrams. Diagrams live in your vault, embed in notes,
link to notes, and can carry strata: notes attached to individual shapes.

The plugin runs Vellum's own editor, built from the Vellum source at a
pinned release. Each new Vellum release produces a new plugin release.

## Features

- **The full Vellum editor** in an Obsidian tab: shapes, connectors, tables,
  icons, layers, several diagrams per file in tabs, undo, find and replace,
  and Vellum's image export (PNG, JPG, WebP, SVG, PDF and animated GIF).
- **Read-only mode** for presenting and reading. Drag to pan, pinch or scroll
  to zoom, and click a shape to open its stratum or link.
- **Strata.** Attach a note to any shape. In edit mode, right-click a shape
  and choose **Add stratum** or **Edit stratum**. In read-only mode, shapes
  with strata glow when you point at them, show a preview, and open the note
  in a floating window when clicked. Strata are ordinary notes, saved beside
  the diagram.
- **Two file formats.** Markdown diagrams (`.vellum.md`) take part in
  Obsidian's search, backlinks and graph, and can hold your own notes beside
  the diagram. Plain `.vellum` files are the format Vellum uses everywhere
  else.
- **Embeds.** `![[Network.vellum]]` shows the diagram in a note, in hover
  previews and on canvases, following Obsidian's light or dark theme. Strata
  and links stay clickable in embeds.
- **Links.** Give a shape a link to a note or web page, or type `[[wikilinks]]`
  into its text. Links appear in backlinks and the graph, show page previews,
  and are updated when the notes they point at are renamed.
- **Vault content.** Drag images, notes and other diagrams from the file
  explorer onto the canvas, or insert them from the canvas menu.
- **Export to the vault**, on request or automatically on save, as sidecar
  images (`Network.vellum.svg`) for Obsidian Publish and other tools.

## Installing

Until the plugin is listed in Obsidian's community plugins, install it with
[BRAT](https://github.com/TfTHacker/obsidian42-brat), which also keeps it up
to date: add the beta plugin `blueprintr-io/vellum-obsidian`.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from
the [latest release](https://github.com/blueprintr-io/vellum-obsidian/releases/latest)
into `<vault>/.obsidian/plugins/vellum/`, then enable **Vellum** under
**Settings → Community plugins**.

## Using it

### Diagrams

Create a diagram with the ribbon button, the **New diagram** item on a folder's
menu, or the command palette (**Vellum: Create new diagram…**). The editor
saves as you work; <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> saves at once.

Switch between edit and read-only mode with the button in the tab header, the
**Toggle read-only mode** command, or the buttons in the editor. A diagram can
choose its own starting mode with the property `vellum-mode: read`.

Obsidian's own shortcuts keep working while the editor has focus, such as
<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>P</kbd> for the command palette and
<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>O</kbd> for the quick switcher.

### Strata

A stratum is a note about one shape: a service's runbook, a component's
design notes, the detail behind a box.

- **Add stratum** (right-click a shape) creates a note named after the
  diagram and the shape, in the diagram's folder, and opens it beside the
  diagram. **Attach existing note** uses a note already in that folder.
- **Edit stratum** opens the note for editing. A shape can have several.
- The **Strata** panel (layers button, top right) lists every stratum in the
  diagram. Pointing at a row highlights its shape; clicking shows the shape.
- In read-only mode and in embeds, clicking a shape opens its stratum.

A stratum records what it belongs to in its properties:

```yaml
vellum-diagram: "[[Network.vellum.md]]"
vellum-shape: shape-1a2b3c4d
vellum-tab: tab-9f8e7d6c
vellum-kind: note
```

Because `vellum-diagram` is a link, Obsidian keeps it current when the
diagram is renamed. When a diagram moves to another folder, its strata move
with it (you can turn this off).

### Embedding

```markdown
![[Network.vellum]]              the diagram
![[Network.vellum|600]]          600 pixels wide
![[Network.vellum#Overview]]     the tab named Overview
![[Network.vellum#^shape-1a2b]]  one shape and what it contains
```

Double-click an embed, or use its open button, to open the diagram. Use
**Copy link to shape** on a shape's menu to get a link to it.

### File format

A Markdown diagram looks like this:

````markdown
---
vellum-plugin: parsed
---
Anything you write here stays with the diagram.

# Vellum Data

## Text
- API Gateway ^shape-1a2b3c4d

## Links
- [[Runbook]] ^shape-1a2b3c4d-link

%%
## Diagram
```vellum
version: workspace-1.0
...
```
%%
````

The **Text** and **Links** sections are written from the diagram on every
save, so Obsidian can search the text and track the links. The YAML in the
**Diagram** block is the same document a `.vellum` file holds. Use **Open as
Markdown** to edit the notes above the data, and the **Convert** commands to
switch a diagram between the two formats. The setting **Compress the diagram
source** keeps very large diagrams out of search results.

### For other plugins and scripts

```js
const vellum = app.plugins.getPlugin('vellum')?.api;
const file = await vellum.createDiagram({ folder: 'Diagrams', name: 'Network' });
const svg = await vellum.exportImage(file, { format: 'svg' });
const strata = vellum.getStrata(file);
```

See [`src/api.ts`](src/api.ts) for the full interface.

## Updates

A scheduled workflow watches Vellum's releases. When a new one appears it
pins the new core and runs the type checks, unit tests, browser tests and
end-to-end tests in a real Obsidian against it, then publishes a plugin
release. Obsidian offers the update under **Settings → Community plugins →
Check for updates**; BRAT installs it automatically. If a Vellum release
fails the checks, no plugin release is published and an issue is opened
instead.

## Privacy

The plugin makes no network requests and collects no data. It reads and
writes only files in your vault, except when you choose a file from your
computer in one of Vellum's own import dialogs. Vellum's bundled icon packs
are not part of the plugin; you can import your own SVG icon libraries.

## Building

You need Node.js 22 or later.

```sh
npm ci
npm run build        # fetches the pinned Vellum release into vendor/vellum
npm test             # unit tests
npm run test:frame   # browser tests (Playwright, Chromium)
xvfb-run -a npm run test:obsidian   # end-to-end tests in a real Obsidian (Linux)
```

The end-to-end tests download the Obsidian release named in
`scripts/obsidian.mjs`, check its SHA-256, and install the built plugin in a
fresh vault. Set `OBSIDIAN_BIN` to use an Obsidian binary you already have.

`vellum-core.json` pins the Vellum release the plugin is built from;
`npm run core -- pin [tag]` moves it. Set `VELLUM_CORE_DIR` to build against
another Vellum checkout, and `OBSIDIAN_PLUGIN_DIR` with `npm run dev` to copy
each build into a vault.

### How it fits together

- `frame/` runs inside the editor: Vellum core plus the strata, links and read
  mode. Each Obsidian view runs it in its own iframe, which keeps Vellum's
  styles, keyboard handling and state apart from Obsidian and from other open
  diagrams.
- `src/` is the plugin: views, the file formats, embeds, strata notes,
  commands and settings.
- `shared/protocol.ts` is the contract between the two.

## License

[PolyForm Noncommercial 1.0.0](LICENSE), the same license as Vellum. For use
outside its terms, contact [Josh Morris](mailto:josh@blueprintr.io). Bundled
packages keep their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
