import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isDir, isFile, portablePath, repoRoot } from './git.js';
import type { MapEdge, MapModel, MapNode, MapView } from './types.js';

const FM = /^---\n([\s\S]*?)\n---\n/;
const SCRIPT_RE = /(?<![\w/.-])((?:scripts|workflows|bin)\/[\w.-]+\.(?:sh|py|js|mjs))/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const read = (p: string) => readFileSync(p, 'utf8');
const toPosix = (p: string) => p.split(sep).join('/');
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();
const groups = (re: RegExp, text: string, i = 1) => [...text.matchAll(re)].map((m) => m[i]);

/** Tiny YAML subset: `key: value`, `key: >-` folded blocks, quoted scalars. */
export function frontmatter(text: string): Record<string, string> {
	const m = FM.exec(text);
	const out: Record<string, string> = {};
	if (!m) return out;
	let key: string | null = null;
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (kv) {
			key = kv[1];
			const val = kv[2].trim();
			out[key] = ['>-', '>', '|', '|-'].includes(val) ? '' : val.replace(/^["']+|["']+$/g, '');
		} else if (key && (line.startsWith(' ') || line.startsWith('\t'))) {
			out[key] = (out[key] + ' ' + line.trim()).trim();
		}
	}
	return out;
}

export function firstSentence(s: string): string {
	return s.trim().split(/(?<=[.!?])\s+(?=[A-Z])/)[0].trim();
}

/** `<dir>/*\/SKILL.md`, sorted. */
function skillFiles(dir: string): string[] {
	if (!isDir(dir)) return [];
	return readdirSync(dir)
		.map((d) => join(dir, d, 'SKILL.md'))
		.filter(isFile)
		.sort();
}

/** Plugin skills: `<root>/**\/skills/<name>/SKILL.md`, sorted. */
function pluginSkillFiles(root: string): string[] {
	const found: string[] = [];
	const walk = (d: string, depth: number) => {
		if (depth > 12) return;
		let entries;
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
			const p = join(d, e.name);
			if (basename(d) === 'skills' && isFile(join(p, 'SKILL.md'))) found.push(join(p, 'SKILL.md'));
			walk(p, depth + 1);
		}
	};
	if (isDir(root)) walk(root, 0);
	return found.sort();
}

interface Skill {
	dir: string;
	md: string;
	text: string;
	fm: Record<string, string>;
}

export interface SkillMapOptions {
	/** Follow every external skill into the skills it triggers. */
	deep?: boolean;
}

/**
 * Build a skeleton map of a Claude Code skill pack from its SKILL.md files, `families.json`,
 * `/skill` mentions, referenced scripts and `hooks/settings-snippet.json`. Enrich the result's
 * `what`, `when` and `how` by hand before rendering.
 */
export function buildSkillMap(skillsDir: string, options: SkillMapOptions = {}): MapModel {
	const sk = resolve(skillsDir);
	const top = repoRoot(sk) ?? dirname(sk);
	const pack = dirname(sk);
	const rel = (p: string) => toPosix(relative(top, p));
	const home = homedir();

	const fam: Record<string, string> = {};
	const famPath = join(sk, 'families.json');
	if (isFile(famPath))
		for (const group of Object.values(JSON.parse(read(famPath)) as Record<string, { skills?: Record<string, string> }>))
			for (const [name, blurb] of Object.entries(group.skills ?? {})) fam[name] = blurb;

	const skills = new Map<string, Skill>();
	for (const md of skillFiles(sk)) {
		const text = read(md);
		const fm = frontmatter(text);
		skills.set(fm.name || basename(dirname(md)), { dir: dirname(md), md, text, fm });
	}

	// skills installed beside the pack's host repo count as known dependencies
	const extMd = new Map<string, string>();
	for (const d of [join(top, '.agents', 'skills'), join(top, '.claude', 'skills'), join(home, '.claude', 'skills')])
		for (const p of skillFiles(d)) if (!extMd.has(basename(dirname(p)))) extMd.set(basename(dirname(p)), resolve(p));
	for (const p of pluginSkillFiles(join(home, '.claude', 'plugins')))
		if (!extMd.has(basename(dirname(p)))) extMd.set(basename(dirname(p)), resolve(p));
	const knownExt = new Set(extMd.keys());

	const origin = (name: string): string => {
		const p = extMd.get(name) ?? '';
		const plugin = /\/plugins\/(?:cache\/)?([^/]+)\//.exec(p);
		if (plugin) return plugin[1] + ' plugin';
		const vendor = /\/vendor\/([^/]+)\//.exec(p);
		if (vendor) return vendor[1];
		return p.startsWith(join(home, '.claude')) ? '~/.claude/skills' : 'repo skills';
	};

	const extMentions = (text: string, own: string): string[] => {
		const found = new Set<string>(groups(/`([a-z][\w-]*:[a-z][\w-]*)`/g, text).map((d) => d.split(':')[1]));
		for (const w of groups(/`\/?([a-z][a-z0-9-]+)`/g, text)) found.add(w);
		for (const w of groups(/(?<![\w/])\/([a-z][a-z0-9-]+)\b/g, text)) found.add(w);
		return [...found].filter((w) => knownExt.has(w) && w !== own && !skills.has(w));
	};

	const nodes = new Map<string, MapNode>();
	const edges: MapEdge[] = [];
	const views: (MapView & { star?: string })[] = [];
	const addNode = (n: MapNode) => {
		if (!nodes.has(n.id)) nodes.set(n.id, n);
		return n.id;
	};
	const edge = (from: string, to: string, label: string, when = '') => {
		if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, label, when });
	};
	const useWhen = (desc: string) => {
		const m = /\bUse (?:it )?when ([\s\S]*)$/.exec(desc);
		return m ? 'Use when ' + m[1].trim() : '';
	};
	const addExt = (n: string): string => {
		const did = 'dep:' + n;
		if (!nodes.has(did)) {
			const md = extMd.get(n);
			const desc = (md ? frontmatter(read(md)) : {}).description ?? '';
			addNode({
				id: did,
				label: n,
				kind: 'external',
				external: true,
				origin: origin(n),
				verbs: [],
				what: firstSentence(desc),
				when: useWhen(desc),
				how: '',
				source: portablePath(md, top)
			});
		}
		return did;
	};

	for (const [name, s] of skills) {
		const desc = s.fm.description ?? '';
		const blurb = fam[name] ?? '';
		const kind = /\blane\b/i.test(blurb) ? 'lane' : 'public';
		const verbs: string[] = [];
		for (const v of groups(new RegExp('`/?' + escapeRe(name) + ' ([a-z][a-z-]+)', 'g'), s.text))
			if (!verbs.includes(v)) verbs.push(v);
		const body = s.text.replace(FM, '');
		const para =
			body
				.split(/\n\s*\n/)
				.map((p) => p.trim())
				.find((p) => p && !['#', '|', '-', '```', '>'].some((c) => p.startsWith(c))) ?? '';
		addNode({
			id: name,
			label: kind === 'lane' ? name : '/' + name,
			kind,
			verbs,
			what: blurb || firstSentence(desc),
			when: useWhen(desc),
			how: para.replace(/\s+/g, ' ').slice(0, 400),
			source: rel(s.md)
		});
		for (const v of verbs) {
			const vid = `${name}:${v}`;
			const vre = new RegExp('`/?' + escapeRe(name) + ' ' + escapeRe(v) + '\\b');
			const lines = s.text.split(/\r?\n/).filter((l) => vre.test(l));
			const row = lines.find((l) => l.trimStart().startsWith('|')) ?? lines[0] ?? '';
			const cells = row.trimStart().startsWith('|')
				? row
						.trim()
						.replace(/^\|+|\|+$/g, '')
						.split('|')
						.map((c) => c.trim())
				: [];
			const what = cells.length ? cells[cells.length - 1] : '';
			addNode({
				id: vid,
				label: `/${name} ${v}`,
				kind: 'public',
				verbs: [],
				what: what.replace(/`/g, '').slice(0, 300),
				when: `User runs \`/${name} ${v}\``,
				how: '',
				source: rel(s.md)
			});
			edge(name, vid, 'verb');
		}
	}

	// mentions: skills, scripts, external skill deps
	for (const [name, s] of skills) {
		const text = s.text.replace(FM, '');
		for (const other of skills.keys()) {
			const o = escapeRe(other);
			if (other !== name && new RegExp('(?:`/?' + o + '`|/' + o + '\\b)').test(text)) edge(name, other, 'invokes');
		}
		for (const m of uniqSorted(groups(SCRIPT_RE, text))) {
			const base = m.split('/').slice(1).join('/');
			const cand = [join(s.dir, m), join(pack, m)];
			const packSkills = join(pack, 'skills');
			if (isDir(packSkills)) for (const d of readdirSync(packSkills)) cand.push(join(packSkills, d, 'scripts', base));
			const hit = cand.find(isFile);
			const sid = 'script:' + base;
			addNode({
				id: sid,
				label: base,
				kind: 'script',
				verbs: [],
				what: '',
				when: `Run by ${name}`,
				how: '',
				source: hit ? rel(hit) : m
			});
			edge(name, sid, 'runs');
		}
		const deps = new Set<string>();
		for (const d of groups(/`([a-z][\w-]*:[a-z][\w-]*)`/g, text)) {
			const short = d.split(':')[1];
			if (knownExt.has(short) && !skills.has(short)) deps.add(d);
		}
		for (const w of groups(/`\/?([a-z][a-z0-9-]+)`/g, text)) if (knownExt.has(w) && !skills.has(w)) deps.add(w);
		for (const d of [...deps].sort()) {
			const short = d.split(':').pop()!;
			addExt(short);
			edge(name, 'dep:' + short, 'uses');
		}
	}

	// board
	const boardUsers = [...skills].filter(([, s]) => /GitHub Project/.test(s.text)).map(([n]) => n);
	if (boardUsers.length) {
		addNode({
			id: 'board',
			label: 'GitHub Project',
			kind: 'board',
			verbs: [],
			what: 'The Project board: cards move Backlog → Ready → Build → QA → Review → Done.',
			when: 'Read and written by every lane',
			how: '',
			source: ''
		});
		for (const n of boardUsers) edge(n, 'board', 'moves cards');
	}

	// verb mentions of lanes → verb view edges
	for (const [name, s] of skills) {
		for (const v of nodes.get(name)!.verbs ?? []) {
			const vid = `${name}:${v}`;
			const vre = new RegExp('\\b' + escapeRe(name) + ' ' + escapeRe(v) + '\\b');
			let chunk = s.text
				.split(/\r?\n/)
				.filter((l) => vre.test(l))
				.join('\n');
			for (const ref of uniqSorted(groups(/(references\/[\w.-]+\.md)/g, chunk))) {
				// follow the verb's routed reference
				const rp = join(s.dir, ref);
				if (isFile(rp)) chunk += '\n' + read(rp);
			}
			for (const other of skills.keys())
				if (other !== name && new RegExp('\\b' + escapeRe(other) + '\\b').test(chunk)) edge(vid, other, 'dispatches');
			for (const m of uniqSorted(groups(SCRIPT_RE, chunk))) {
				const sid = 'script:' + m.split('/').slice(1).join('/');
				if (nodes.has(sid)) edge(vid, sid, 'runs');
			}
		}
	}

	// hooks
	const snip = join(pack, 'hooks', 'settings-snippet.json');
	const hookIds: string[] = [];
	if (isFile(snip)) {
		type HookGroup = { matcher?: string; hooks?: { command?: string }[] };
		const cfg = (JSON.parse(read(snip)).hooks ?? {}) as Record<string, HookGroup[]>;
		for (const [event, grps] of Object.entries(cfg)) {
			const eid = 'event:' + event;
			addNode({
				id: eid,
				label: event,
				kind: 'hook',
				verbs: [],
				what: `Claude Code ${event} event`,
				when: 'Every matching tool call',
				how: '',
				source: rel(snip)
			});
			hookIds.push(eid);
			for (const g of grps) {
				for (const h of g.hooks ?? []) {
					const script = /([\w.-]+\.py)/.exec(h.command ?? '');
					if (!script) continue;
					const hid = 'hook:' + script[1];
					const hp = join(pack, 'hooks', script[1]);
					addNode({
						id: hid,
						label: script[1],
						kind: 'hook',
						verbs: [],
						what: '',
						when: '',
						how: '',
						source: isFile(hp) ? rel(hp) : ''
					});
					const node = nodes.get(hid)!;
					const tag = `${event}: ${g.matcher ?? '*'}`;
					node.when = node.when ? `${node.when}; ${tag}` : tag;
					if (!hookIds.includes(hid)) hookIds.push(hid);
					edge(eid, hid, (g.matcher ?? '*').slice(0, 18), tag);
				}
			}
		}
	}

	// views: overview → per-skill → per-verb; hooks view
	const topIds = [...skills.keys(), ...(nodes.has('board') ? ['board'] : [])];
	const packName = basename(pack);
	views.push({
		id: 'overview',
		parent: null,
		title: packName,
		nodeIds: [...topIds, ...(hookIds.length ? ['hooks'] : [])]
	});
	if (hookIds.length) {
		addNode({
			id: 'hooks',
			label: 'Guard hooks',
			kind: 'hook',
			verbs: [],
			what: `${hookIds.filter((h) => h.startsWith('hook:')).length} guard scripts wired into settings.json`,
			when: 'Installed by install.sh unless --no-hooks',
			how: '',
			source: rel(snip)
		});
		views.push({ id: 'hooks', parent: 'overview', title: 'Guard hooks', nodeIds: hookIds });
	}
	for (const name of skills.keys()) {
		const outIds = edges.filter((e) => e.from === name).map((e) => e.to);
		if (!outIds.length) continue;
		views.push({ id: name, parent: 'overview', title: nodes.get(name)!.label, nodeIds: [name, ...outIds], star: name });
		for (const v of nodes.get(name)!.verbs ?? []) {
			const vid = `${name}:${v}`;
			const kids = edges.filter((e) => e.from === vid).map((e) => e.to);
			if (kids.length) views.push({ id: vid, parent: name, title: `/${name} ${v}`, nodeIds: [vid, ...kids], star: vid });
		}
	}
	for (const v of views) {
		// view edges: every model edge whose ends are both on the view; a skill's view shows what it triggers
		const ids = new Set(v.nodeIds);
		v.edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (!v.star || e.from === v.star));
		delete v.star;
	}

	if (options.deep) {
		// external skills open onto the skills they trigger, as deep as the files go
		const queue = [...nodes.keys()].filter((i) => i.startsWith('dep:')).map((i) => i.slice(4));
		const seen = new Set<string>();
		while (queue.length) {
			const n = queue.shift()!;
			const md = extMd.get(n);
			if (seen.has(n) || !md) continue;
			seen.add(n);
			const kids = extMentions(read(md).replace(FM, ''), n).sort();
			if (!kids.length) continue;
			for (const k of kids) {
				addExt(k);
				edge('dep:' + n, 'dep:' + k, 'triggers');
				queue.push(k);
			}
			const parent = views.find((v) => v.nodeIds.includes('dep:' + n))?.id ?? 'overview';
			const ids = ['dep:' + n, ...kids.map((k) => 'dep:' + k)];
			views.push({
				id: 'dep:' + n,
				parent,
				title: n,
				nodeIds: ids,
				edges: edges.filter((e) => e.from === 'dep:' + n && ids.includes(e.to))
			});
		}
	}

	return {
		title: `${packName} skill map`,
		subtitle: 'Skeleton generated by nomo-flowchart skillmap — enrich what/when/how',
		nodes: [...nodes.values()],
		edges,
		views
	};
}
