# nomo-flowchart-display

Interactive flowchart pages from a JSON file, for Node and JavaScript projects. You describe nodes, edges and views; the library lays them out and writes **one self-contained HTML file**: no build step, no CDN and no runtime dependencies in the page.

What the page does:

- **Layered auto-layout** with crossing-minimising ordering, baked into the page at render time.
- **Orthogonal edge routing**: every edge gets its own port and its own right-angle route, with no shared lines.
- **Drill-down views**: double-click a stacked node to open its inner view; breadcrumbs, Esc and the back button go up; `#view=<id>&node=<id>` deep-links.
- **Viewer**: wheel/pinch zoom, drag to pan, a minimap, search (⌘K), a details panel per node, animated flow, light and dark themes, SVG and PNG export.
- **Self-check**: an optional headless-Chrome pass screenshots the page and fails on edge crossings, overlapping lines, labels on lines and text overflowing its box.

It also renders branch recaps, plans and code walkthroughs from a `data.json`, and can run as a Claude Code skill.

## Install

```bash
npm install github:MikeSpock/nomo-flowchart-display
```

Requires Node 18.17+. The package has no runtime dependencies. Layout baking and the self-check use Google Chrome or Chromium when one is installed (set `CHROME_PATH` to pick a binary); without one, pages still render, with the layout computed in the browser on load.

## Use it from code

```ts
import { renderMap } from 'nomo-flowchart-display';

const result = await renderMap(
	{
		title: 'Checkout flow',
		nodes: [
			{ id: 'cart', label: 'Cart', kind: 'public', what: 'Where checkout starts.' },
			{ id: 'api', label: 'Checkout API', kind: 'lane', what: 'Prices the order.' }
		],
		edges: [{ id: 'e1', from: 'cart', to: 'api', label: 'starts' }],
		views: [{ id: 'overview', parent: null, title: 'Checkout', nodeIds: ['cart', 'api'] }]
	},
	{ out: 'public/checkout.html' }
);
console.log(result.out, result.check?.counts);
```

| Function | Does |
| --- | --- |
| `renderMap(model, options)` | Render a map object to a file. Bakes layouts and runs the check when Chrome is available. |
| `renderMapFile(path, options)` | Same, from a map JSON file. Relative `source` paths resolve against the file's repo. |
| `renderDataFile(path, options)` / `renderPage(data, options)` | Render a recap, plan or explore page. Recaps pull files, stats and hunks from git. |
| `renderToString(modelOrData)` | Return the HTML string. No disk, git, network or Chrome. |
| `validateMap(model)` | List dangling ids and other hard errors. |
| `buildSkillMap(dir, { deep })` | Build a map skeleton from a folder of Claude Code skills. |
| `runCheck(page, { isMap })` | Run the headless-Chrome check on a rendered page. |

`RenderOptions`: `out`, `cwd`, `optimize` (bake layouts, default on), `check` (default on), `shots`, `open`, `avatars` (inline GitHub avatars for `authors`, default on), `sourceBase` / `sourceRoot` (link node sources to hosted files), `template`, `chrome` (a binary path, or `null` to skip Chrome).

### In the browser or a bundler

`nomo-flowchart-display/core` has no Node imports. Pair it with the template (exported as `nomo-flowchart-display/template.html`) to build pages anywhere:

```ts
import { buildPage, mapToPage, validateMap } from 'nomo-flowchart-display/core';
import template from 'nomo-flowchart-display/template.html?raw'; // Vite; use your bundler's raw import

const html = buildPage(template, mapToPage(model));
iframe.srcdoc = html;
```

## CLI

```bash
npx nomo-flowchart render --map examples/checkout/map.json --out examples/checkout/index.html
```

| Command | Does |
| --- | --- |
| `render --map map.json` | Render a drill-down map |
| `render data.json` | Render a recap, plan or explore page ([references/sections.md](references/sections.md)) |
| `skillmap <skills-dir> [--deep] [--out map.json]` | Build a map skeleton from a folder of Claude Code skills |
| `check page.html` | Run the headless-Chrome check on a rendered page |
| `facts [--base REF]` | Print git facts for a recap |
| `detect [--base REF]` | Suggest a mode for the current repo |

`render` flags: `--out`, `--no-open`, `--no-check`, `--no-optimize`, `--no-avatars`, `--shots DIR`, `--source-base URL`, `--source-root DIR`. It prints a JSON result and exits with code 2 when the check finds overlaps.

## The map format

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

A node opens a child view when `opensView` names one, or when a view shares the node's id. Node `kind` picks the card style: `public`, `lane`, `external`, `verb`, `script`, `hook` or `board`. The TypeScript types are exported (`MapModel`, `MapNode`, `MapEdge`, `MapView`).

The full contract is in [references/schema.md](references/schema.md): swimlanes, nested containers, process views, per-view overrides, planned nodes, author avatars and source links.

## Claude Code skill

[skill/SKILL.md](skill/SKILL.md) turns this into the `/visual` skill: recap a branch, picture a plan, or map a codebase or skill pack. Install it with:

```bash
skill/install.sh
```

This builds the CLI if needed and copies the skill and the renderer to `~/.claude/skills/visual/`. Pass a folder to install somewhere else, e.g. `skill/install.sh .claude/skills` for one project.

## Examples

- [examples/checkout/map.json](examples/checkout/map.json): a small two-level map (`npm run example` renders it)
- [examples/super-board-skill-map.json](examples/super-board-skill-map.json): a large real map (super-board's skill pack)

## Development

```bash
npm install
npm run build
```

Sources are in `src/`; the page itself (layout, routing, viewer) is `assets/template.html`.

## Credits

Forked from the `/visual` skill in [EricTechPro/super-board](https://github.com/EricTechPro/super-board) (MIT), which credits [BuilderIO/skills](https://github.com/BuilderIO/skills) and [tt-a1i/archify](https://github.com/tt-a1i/archify). The Node library is a TypeScript port of its Python script. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
