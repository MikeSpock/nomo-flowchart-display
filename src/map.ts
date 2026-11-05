import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mapToPage } from './core.js';
import { portablePath, repoRoot } from './git.js';
import type { MapModel, MapNode, PageData } from './types.js';

export interface LoadedMap {
	data: PageData;
	/** The repo (or folder) the map's `source` paths are relative to. */
	root: string;
}

/** Read a map file into page data: title defaulted, intake logos inlined, `source` set. */
export function loadMap(path: string): LoadedMap {
	const abs = resolve(path);
	const model = JSON.parse(readFileSync(abs, 'utf8')) as MapModel;
	const data = mapToPage(model, basename(abs).replace(/\.[^.]+$/, ''));
	const root = repoRoot(dirname(abs)) ?? dirname(abs);
	data.source ??= portablePath(abs, root);
	embedLogos(data, dirname(abs));
	return { data, root };
}

/** Inline each view's intake `logo` (an SVG path relative to `base`), so the page works offline. */
export function embedLogos(d: PageData, base: string): number {
	let n = 0;
	for (const v of (d.views as MapModel['views']) ?? []) {
		for (const src of v.intake ?? []) {
			const logo = src.logo;
			if (!logo || String(logo).startsWith('data:')) continue;
			const p = join(base, logo);
			if (existsSync(p) && statSync(p).isFile()) {
				src.logo = 'data:image/svg+xml;base64,' + readFileSync(p).toString('base64');
				n++;
			}
		}
	}
	return n;
}

/** Fetch each author's GitHub avatar once (cached, 96 px) and inline it, so the page works
 * offline. A failed fetch leaves the author alone; the page shows initials instead. */
export async function embedAvatars(
	d: PageData,
	cacheDir = join(homedir(), '.cache', 'nomo-flowchart', 'avatars')
): Promise<number> {
	mkdirSync(cacheDir, { recursive: true });
	let n = 0;
	const authors = (d.authors as MapModel['authors']) ?? {};
	for (const [login, a] of Object.entries(authors)) {
		if (!a || typeof a !== 'object' || String(a.avatar ?? '').startsWith('data:')) continue;
		const f = join(cacheDir, `${login.replace(/[^A-Za-z0-9_.-]/g, '_')}@96.png`);
		if (!existsSync(f) || statSync(f).size < 100) {
			try {
				const r = await fetch(
					`https://github.com/${encodeURIComponent(login)}.png?size=96`,
					{ headers: { 'User-Agent': 'nomo-flowchart' }, signal: AbortSignal.timeout(10_000) }
				);
				if (!r.ok) continue;
				writeFileSync(f, Buffer.from(await r.arrayBuffer()));
			} catch {
				continue;
			}
		}
		const bytes = readFileSync(f);
		const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		a.avatar = `data:${jpeg ? 'image/jpeg' : 'image/png'};base64,` + bytes.toString('base64');
		n++;
	}
	return n;
}

const toPosix = (p: string) => p.split(sep).join('/');

function within(root: string, p: string): string | null {
	const rel = relative(root, p);
	if (rel.startsWith('..') || isAbsolute(rel)) return null;
	return toPosix(rel);
}

/**
 * Rewrite each node `source` under `srcRoot` to `base + <path from srcRoot>` (`file:12-20` →
 * `#L12-L20`), so a page published away from the checkout (e.g. GitHub Pages) links to the hosted
 * file. Sources outside `srcRoot` keep their text and get no link. Returns how many were linked.
 */
export function linkSources(data: PageData, repo: string, srcRoot: string, base: string): number {
	base = base.replace(/\/+$/, '') + '/';
	const prefix = String(data.sourcesBase ?? '').replace(/^\/+|\/+$/g, '');
	const one = (s: unknown): [unknown, number] => {
		if (typeof s !== 'string' || !s || /^https?:/.test(s) || s.startsWith('~')) return [s, 0];
		const m = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(s)!;
		const rel = within(srcRoot, resolve(repo, prefix, m[1]));
		if (rel == null) return [s, 0];
		const anchor = m[2] ? `#L${m[2]}` + (m[3] ? `-L${m[3]}` : '') : '';
		return [base + rel.split('/').map(encodeURIComponent).join('/') + anchor, 1];
	};
	const views = (data.views as MapModel['views']) ?? [];
	const nodes: Partial<MapNode>[] = [
		...((data.nodes as MapNode[]) ?? []),
		...views.flatMap((v) => v.nodes ?? []),
		...views.flatMap((v) => Object.values(v.nodeOverrides ?? {}))
	];
	let n = 0;
	for (const node of nodes) {
		const src = node.source;
		if (Array.isArray(src)) {
			const pairs = src.map(one);
			node.source = pairs.map((p) => p[0]) as string[];
			n += pairs.reduce((s, p) => s + p[1], 0);
		} else if (src) {
			const [v, c] = one(src);
			node.source = v as string;
			n += c;
		}
	}
	if (typeof data.source === 'string' && !data.source.startsWith('~')) {
		const rel = within(srcRoot, resolve(repo, data.source));
		if (rel != null) data.source = rel;
	}
	data.sourcesBase = '';
	const meta = (data.meta ??= {});
	meta.sourceBase = base;
	meta.root = ''; // links are absolute now; don't publish the checkout's folder depth
	meta.project = resolve(srcRoot) === resolve(repo) ? meta.project : basename(srcRoot);
	return n;
}
