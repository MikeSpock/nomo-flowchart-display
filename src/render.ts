import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignAreas, buildPage, isoMinutes, mapToPage, slug, validateMap } from './core.js';
import { findChrome, pageLayouts, runCheck } from './chrome.js';
import { git, gitOk, recapFacts, repoRoot } from './git.js';
import { resolveHunk } from './hunks.js';
import { embedAvatars, linkSources, loadMap } from './map.js';
import type { CheckResult, Hunk, MapModel, PageData } from './types.js';

/** Absolute path of the bundled template. */
export const TEMPLATE_PATH = fileURLToPath(new URL('../assets/template.html', import.meta.url));

let templateCache: string | undefined;
export function readTemplate(): string {
	return (templateCache ??= readFileSync(TEMPLATE_PATH, 'utf8'));
}

export interface RenderOptions {
	/** Where to write the page. Default: `_tmp/<date>-visual/` if the repo ignores `_tmp/`,
	 * else a self-ignoring `.visual/` folder, both in the current repo. */
	out?: string;
	/** Folder to treat as the project (git commands, default output). Default: `process.cwd()`. */
	cwd?: string;
	/** Root that relative node sources resolve against. Default: the repo containing `cwd`. */
	sourceRootDir?: string;
	/** Maps: let headless Chrome search for crossing-free layouts and bake them in. Default: true. */
	optimize?: boolean;
	/** Run the headless-Chrome check after writing. Default: true. */
	check?: boolean;
	/** Folder for check screenshots. */
	shots?: string;
	/** Open the page in the default browser. Default: false. */
	open?: boolean;
	/** Maps: fetch GitHub avatars for `authors` and inline them. Default: true. */
	avatars?: boolean;
	/** URL prefix for node sources, e.g. `https://github.com/OWNER/REPO/blob/main/`. */
	sourceBase?: string;
	/** With `sourceBase`: the folder that prefix maps to. Default: the source root. */
	sourceRoot?: string;
	/** Use this template text instead of the bundled one. */
	template?: string;
	/** Chrome binary for layout baking and the check; `null` disables both. Default: auto-detect. */
	chrome?: string | null;
}

export interface RenderResult {
	out: string;
	bytes: number;
	missingHunks: string[];
	bakedLayouts?: number;
	check?: CheckResult;
	/** The page data as written (after facts, hunks, avatars and baked layouts). */
	data: PageData;
}

/** Default output file for a page in `root`. */
export function outputPath(root: string, data: PageData): string {
	const name = `${slug(String(data.slug || data.title || 'visual'))}-${data.kind ?? 'explore'}.html`;
	let d: string;
	if (gitOk(['check-ignore', '-q', '_tmp/visual.html'], root)) {
		d = join(root, '_tmp', `${isoMinutes().slice(0, 10)}-visual`);
	} else {
		d = join(root, '.visual');
		mkdirSync(d, { recursive: true });
		const gi = join(d, '.gitignore');
		if (!existsSync(gi)) writeFileSync(gi, '*\n');
	}
	mkdirSync(d, { recursive: true });
	return join(d, name);
}

/**
 * Render page data (a map from `mapToPage`/`loadMap`, or a recap, plan or explore page) to an HTML
 * file. Recap pages get their files, stats and hunks from git.
 */
export async function renderPage(input: PageData, options: RenderOptions = {}): Promise<RenderResult> {
	const data: PageData = structuredClone(input);
	const cwd = resolve(options.cwd ?? process.cwd());
	const repo = repoRoot(cwd);
	const root = repo ?? cwd;
	const kind = (data.kind ??= 'explore');

	if (kind === 'recap' && repo) {
		const facts = recapFacts(root, (data.base as string) ?? null, data.areas ?? {});
		const notes = (data.fileNotes as Record<string, string>) ?? {};
		if (!data.files?.length) data.files = facts.files;
		for (const f of data.files) if (!('note' in f)) f.note = notes[f.path];
		data.stats ??= facts.stats;
		data.meta = { ...data.meta, branch: facts.branch, base: facts.base, commits: facts.commits };
		const mb = git(['merge-base', facts.base!, 'HEAD'], root).trim();
		data.hunks = (data.hunks ?? []).map((h: Hunk) => resolveHunk(root, mb, h));
	}
	assignAreas(data.files ?? [], data.areas ?? {});

	if (kind === 'map') {
		if (options.avatars !== false) data.avatarsEmbedded = await embedAvatars(data);
		const problems = validateMap(data as Partial<MapModel>);
		if (problems.length) throw new Error('map model problems:\n  ' + problems.join('\n  '));
	}
	const meta = (data.meta ??= {});
	meta.generated = isoMinutes();
	meta.project ??= basename(root);
	const absRoot = resolve(options.sourceRootDir ?? root);
	const out = resolve(options.out ?? outputPath(root, data));
	if (options.sourceBase)
		linkSources(data, absRoot, resolve(options.sourceRoot ?? absRoot), options.sourceBase);
	// repo root relative to the page, so source links resolve wherever the repo is checked out
	meta.root ??= relative(dirname(out), absRoot).split(sep).join('/');

	const template = options.template ?? readTemplate();
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, buildPage(template, data));

	const chrome = options.chrome === undefined ? findChrome() : options.chrome;
	let baked = 0;
	if (kind === 'map' && options.optimize !== false && chrome) {
		// let the page search for crossing-free row orders once, then freeze them as view layouts
		const layouts = await pageLayouts(out, chrome);
		for (const v of (data.views as MapModel['views']) ?? [])
			if (!v.layout && layouts[v.id]) {
				v.layout = layouts[v.id];
				baked++;
			}
		if (baked) writeFileSync(out, buildPage(template, data));
	}

	const result: RenderResult = {
		out,
		bytes: statSync(out).size,
		missingHunks: (data.hunks ?? []).filter((h) => h.missing).map((h) => h.file),
		data
	};
	if (kind === 'map') result.bakedLayouts = baked;
	if (options.check !== false)
		result.check = await runCheck(out, { shots: options.shots, isMap: kind === 'map', chrome });
	if (options.open) openFile(out);
	return result;
}

/** Render a map model object. */
export function renderMap(model: MapModel, options: RenderOptions = {}): Promise<RenderResult> {
	return renderPage(mapToPage(model), options);
}

/** Render a map JSON file. Relative sources resolve against the repo that holds the file. */
export function renderMapFile(path: string, options: RenderOptions = {}): Promise<RenderResult> {
	const { data, root } = loadMap(path);
	return renderPage(data, { sourceRootDir: root, ...options });
}

/** Render a recap, plan or explore `data.json` file. */
export function renderDataFile(path: string, options: RenderOptions = {}): Promise<RenderResult> {
	return renderPage(JSON.parse(readFileSync(path, 'utf8')) as PageData, options);
}

/** Render to an HTML string without touching disk: no git facts, avatars, layout baking or check. */
export function renderToString(data: PageData | MapModel, template = readTemplate()): string {
	const page: PageData = 'views' in data && Array.isArray(data.views) && !data.kind ? mapToPage(data as MapModel) : { ...data };
	if (page.kind === 'map') {
		const problems = validateMap(page as Partial<MapModel>);
		if (problems.length) throw new Error('map model problems:\n  ' + problems.join('\n  '));
	}
	page.meta = { generated: isoMinutes(), ...page.meta };
	assignAreas(page.files ?? [], page.areas ?? {});
	return buildPage(template, page);
}

export function openFile(path: string): void {
	const [cmd, args] =
		process.platform === 'darwin'
			? ['open', [path]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '', path]]
				: ['xdg-open', [path]];
	spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
