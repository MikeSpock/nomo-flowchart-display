/**
 * Environment-free pieces: no Node or DOM APIs, so this module also runs in a browser or a worker.
 * Pass it the template text (e.g. imported from `nomo-flowchart-display/template.html`) and the data.
 */
import type { FileEntry, MapModel, MapNode, PageData } from './types.js';

export const PLACEHOLDER = '/*__VISUAL_DATA__*/null';
export const TITLE_PLACEHOLDER = '__VISUAL_TITLE__';
export const MAP_KINDS = ['public', 'lane', 'external', 'verb', 'script', 'hook', 'board'] as const;

export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inject page data into the template and return the finished, self-contained HTML. */
export function buildPage(template: string, data: PageData): string {
	if (!template.includes(PLACEHOLDER)) throw new Error('template placeholder missing');
	const blob = JSON.stringify(data).replace(/<\//g, '<\\/');
	const title = escapeHtml(String(data.title ?? 'Visual'));
	// split/join: a replacement string would interpret `$&` and friends inside the data
	return template.split(PLACEHOLDER).join(blob).split(TITLE_PLACEHOLDER).join(title);
}

/** Turn a map model into page data (kind `map`, title defaulted from the root view). */
export function mapToPage(model: MapModel, fallbackTitle = 'Map'): PageData {
	const views = model.views ?? [];
	const rootView = views.find((v) => !v.parent) ?? views[0];
	return {
		...model,
		kind: 'map',
		title: model.title || rootView?.title || fallbackTitle
	};
}

/** Every node a map defines: the shared ones plus view-local ones. */
function allNodes(d: Partial<MapModel>): MapNode[] {
	return [...(d.nodes ?? []), ...(d.views ?? []).flatMap((v) => v.nodes ?? [])];
}

/** Hard errors only: dangling ids would render as holes. Returns at most 40 messages. */
export function validateMap(d: Partial<MapModel>): string[] {
	const nodes = allNodes(d);
	const ids = new Set(nodes.map((n) => n.id));
	const views = d.views ?? [];
	const vids = new Set(views.map((v) => v.id));
	const out: string[] = [];
	const seen = new Set<string>();
	const q = (s: unknown) => (s == null ? 'None' : `'${s}'`);
	for (const n of nodes) {
		if (!n.id || seen.has(n.id)) out.push(`missing or duplicate node id ${q(n.id)}`);
		seen.add(n.id);
		if (n.opensView && !vids.has(n.opensView))
			out.push(`node ${q(n.id)}: opens unknown view ${q(n.opensView)}`);
	}
	if (!views.length) out.push('no views');
	for (const v of views) {
		const vn = q(v.id);
		if (v.parent && !vids.has(v.parent) && !ids.has(v.parent))
			out.push(`view ${vn}: parent ${q(v.parent)} is not a view`);
		for (const [nid, override] of Object.entries(v.nodeOverrides ?? {})) {
			if (!ids.has(nid)) out.push(`view ${vn}: overrides unknown node ${q(nid)}`);
			if (override.opensView && !vids.has(override.opensView))
				out.push(`view ${vn}: override opens unknown view ${q(override.opensView)}`);
		}
		for (const i of v.nodeIds ?? []) if (!ids.has(i)) out.push(`view ${vn}: unknown node ${q(i)}`);
		const members = new Set(v.nodeIds ?? []);
		for (const i of v.stepIds ?? [])
			if (!members.has(i)) out.push(`view ${vn}: main step ${q(i)} is not in nodeIds`);
		for (const i of v.browserOrder ?? [])
			if (!vids.has(i)) out.push(`view ${vn}: browser opens unknown view ${q(i)}`);
		const containers = v.containers ?? [];
		const families = new Map(containers.map((f) => [f.id, f]));
		if (families.has(undefined as unknown as string) || families.size !== containers.length)
			out.push(`view ${vn}: missing or duplicate container id`);
		for (const [fid, family] of families) {
			for (const i of family.nodeIds ?? [])
				if (!members.has(i))
					out.push(`view ${vn}: container ${q(fid)} includes non-visible node ${q(i)}`);
			const trail = new Set<string>();
			let cursor: string | undefined = fid;
			while (cursor) {
				if (trail.has(cursor)) {
					out.push(`view ${vn}: cyclic container ${q(fid)}`);
					break;
				}
				trail.add(cursor);
				const f = families.get(cursor);
				if (!f) {
					out.push(`view ${vn}: container ${q(fid)} has unknown parent ${q(cursor)}`);
					break;
				}
				cursor = f.parent;
			}
		}
		for (const src of v.intake ?? [])
			if (!src.to || !members.has(src.to))
				out.push(`view ${vn}: intake ${q(src.label)} feeds non-visible node ${q(src.to)}`);
		for (const i of v.tour ?? [])
			if (!members.has(i)) out.push(`view ${vn}: tour stop ${q(i)} is not in nodeIds`);
		for (const e of v.edges ?? [])
			if (typeof e === 'object' && e && (!ids.has(e.from) || !ids.has(e.to)))
				out.push(`view ${vn}: edge ${e.from}->${e.to} has an unknown end`);
	}
	for (const e of d.edges ?? [])
		if (!ids.has(e.from) || !ids.has(e.to)) out.push(`edge ${e.from}->${e.to} has an unknown end`);
	return out.slice(0, 40);
}

/** Group label and the path prefix a file row may drop. Longest matching `areas` prefix wins. */
export function areaOf(path: string, areas: Record<string, string> = {}): [string, string] {
	for (const prefix of Object.keys(areas).sort((a, b) => b.length - a.length))
		if (path.startsWith(prefix)) return [areas[prefix], prefix];
	const prefix = path.split('/').slice(0, -1).slice(0, 3).join('/');
	return [prefix || '(root)', prefix ? prefix + '/' : ''];
}

/** Fill `area` and `prefix` on files that lack them. */
export function assignAreas(files: FileEntry[], areas: Record<string, string> = {}): void {
	for (const f of files) if (!('area' in f)) [f.area, f.prefix] = areaOf(f.path, areas);
}

/** Local time as `YYYY-MM-DDTHH:MM`. */
export function isoMinutes(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function slug(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'visual'
	);
}
