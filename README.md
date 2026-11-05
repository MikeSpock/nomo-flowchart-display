# nomo-flowchart-display

Interactive flowchart pages from a JSON file. You describe nodes, edges and views; a Python script lays them out and writes **one self-contained HTML file**: no build step, no CDN, no runtime dependencies.

What the page does:

- **Layered auto-layout** with crossing-minimising ordering, baked into the page at render time.
- **Orthogonal edge routing**: every edge gets its own port and its own right-angle route, with no shared lines.
- **Drill-down views**: double-click a stacked node to open its inner view; breadcrumbs, Esc and the back button go up; `#view=<id>&node=<id>` deep-links.
- **Viewer**: wheel/pinch zoom, drag to pan, a minimap, search (⌘K), a details panel per node, animated flow, light and dark themes, SVG and PNG export.
- **Self-check**: an optional headless-Chrome pass screenshots the page and fails on edge crossings, overlapping lines, labels on lines and text overflowing its box.

It also renders branch recaps, plans and code walkthroughs from a `data.json`, and can run as a Claude Code skill (see [Claude Code skill](#claude-code-skill)).

## Requirements

- Python 3.9+ (standard library only)
- `git`, for recap mode and for resolving source links
- Google Chrome or Chromium, only for the self-check (`--no-check` skips it)

## Quick start

```bash
python3 scripts/visual.py render --map examples/checkout/map.json --out examples/checkout/index.html
```

Open `examples/checkout/index.html` in a browser. Add `--no-check` to skip the Chrome pass and `--no-open` to keep the page from opening.

## The map file

```jsonc
{
	"title": "Checkout flow",
	"nodes": [
		{ "id": "cart", "label": "Cart", "kind": "public",
		  "what": "What it is.", "when": "What triggers it.", "how": "How it works (markdown)." }
	],
	"edges": [{ "id": "e1", "from": "cart", "to": "checkout-api", "label": "starts" }],
	"views": [
		{ "id": "overview", "parent": null, "title": "Checkout", "nodeIds": ["cart", "checkout-api"] },
		{ "id": "checkout-api", "parent": "overview", "title": "Checkout API", "nodeIds": ["..."] }
	]
}
```

A node opens a child view when `opensView` names one, or when a view shares the node's id. Node `kind` picks the card style: `public`, `lane`, `external`, `verb`, `script`, `hook` or `board`.

The full contract is in [references/schema.md](references/schema.md): swimlanes, nested containers, process views, per-view overrides, planned nodes, author avatars and source links.

## Commands

| Command | Does |
| --- | --- |
| `render --map map.json` | Render a drill-down map |
| `render data.json` | Render a recap, plan or explore page ([references/sections.md](references/sections.md)) |
| `skillmap <skills-dir> --deep --out map.json` | Build a map skeleton from a folder of Claude Code skills |
| `facts [--base REF]` | Print git facts for a recap |
| `detect` | Suggest a mode for the current repo |
| `check page.html` | Run the headless-Chrome check on a rendered page |

## Claude Code skill

[skill/SKILL.md](skill/SKILL.md) turns this into the `/visual` skill: recap a branch, picture a plan, or map a codebase or skill pack. Install it with:

```bash
skill/install.sh
```

This copies the skill and the renderer to `~/.claude/skills/visual/`. Pass a folder to install somewhere else, e.g. `skill/install.sh .claude/skills` for one project.

## Examples

- [examples/checkout/map.json](examples/checkout/map.json): a small two-level map
- [examples/super-board-skill-map.json](examples/super-board-skill-map.json): a large real map (super-board's skill pack)

## Credits

Forked from the `/visual` skill in [EricTechPro/super-board](https://github.com/EricTechPro/super-board) (MIT), which credits [BuilderIO/skills](https://github.com/BuilderIO/skills) and [tt-a1i/archify](https://github.com/tt-a1i/archify). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
