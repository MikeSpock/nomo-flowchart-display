import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { areaOf, isoMinutes } from './core.js';
import type { Commit, FileEntry, GitState, RecapFacts } from './types.js';

const PLAN_NAME = /(plan|prd|spec|design|rfc|proposal)/i;

/** Run git; returns stdout, or '' on failure unless `check` is set. `okCodes` lists exit codes
 * that still count as success (`git diff --no-index` exits 1 when the files differ). */
export function git(args: string[], cwd?: string, check = true, okCodes = [0]): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (!okCodes.includes(r.status ?? -1)) {
		if (check) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
		return '';
	}
	return r.stdout;
}

export function gitOk(args: string[], cwd?: string): boolean {
	return spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;
}

const lines = (s: string) => s.split(/\r?\n/).filter((l) => l !== '');

export function repoRoot(cwd?: string): string | null {
	return git(['rev-parse', '--show-toplevel'], cwd, false).trim() || null;
}

export function refExists(ref: string, root: string): boolean {
	return gitOk(['rev-parse', '--verify', '--quiet', ref + '^{commit}'], root);
}

export function defaultBase(root: string): string | null {
	for (const ref of ['main', 'master', 'trunk', 'develop']) if (refExists(ref, root)) return ref;
	const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], root, false).trim();
	return head.replace(/^refs\/remotes\//, '') || null;
}

/** A path safe to publish: repo-relative inside `root`, `~/…` under home, else the bare name. */
export function portablePath(p: string | null | undefined, root: string): string {
	if (!p) return '';
	if (!isAbsolute(p)) return p.split(sep).join('/');
	for (const [base, prefix] of [
		[root, ''],
		[homedir(), '~/']
	] as const) {
		const rel = relative(resolve(base), resolve(p));
		if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return prefix + rel.split(sep).join('/');
	}
	return basename(p);
}

export function gitState(root: string, base?: string | null): GitState {
	const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
	const b = base || defaultBase(root);
	const mb = b ? git(['merge-base', b, 'HEAD'], root, false).trim() : '';
	let commits: Commit[] = [];
	if (mb)
		commits = lines(git(['log', '--format=%h%x09%s', `${mb}..HEAD`], root, false)).map((l) => {
			const i = l.indexOf('\t');
			return { sha: l.slice(0, i), subject: l.slice(i + 1) };
		});
	const dirty = lines(git(['status', '--porcelain'], root)).length;
	const changed = mb ? lines(git(['diff', '--name-only', mb], root, false)) : [];
	const untracked = lines(git(['ls-files', '--others', '--exclude-standard'], root));
	return {
		root,
		branch,
		base: b,
		mergeBase: mb.slice(0, 12),
		commitsAhead: commits.length,
		commits,
		dirty,
		changedFiles: mb ? new Set([...changed, ...untracked]).size : dirty,
		onBase: branch === b
	};
}

export interface PlanCandidate {
	path: string;
	modified: string;
}

/** Recent plan-like markdown files: anything in a `plans/` folder from the last day, or a
 * plan/spec/rfc-named file from the last two weeks. Newest five. */
export function planCandidates(root: string | null): PlanCandidate[] {
	const now = Date.now();
	const found: [number, string][] = [];
	const dirs = [join(homedir(), '.claude', 'plans')];
	if (root)
		dirs.push(
			root,
			join(root, 'docs'),
			join(root, 'plans'),
			join(root, '.claude', 'plans'),
			join(root, 'specs')
		);
	for (const d of dirs) {
		if (!isDir(d)) continue;
		for (const name of readdirSync(d)) {
			if (!name.endsWith('.md')) continue;
			const p = join(d, name);
			const st = statSync(p, { throwIfNoEntry: false });
			if (!st?.isFile()) continue;
			const age = (now - st.mtimeMs) / 1000;
			const inPlans = basename(d) === 'plans';
			if ((inPlans && age < 86400) || (PLAN_NAME.test(name.slice(0, -3)) && age < 14 * 86400))
				found.push([st.mtimeMs, p]);
		}
	}
	found.sort((a, b) => b[0] - a[0]);
	return found.slice(0, 5).map(([m, p]) => ({ path: p, modified: isoMinutes(new Date(m)) }));
}

export interface Detection {
	cwd: string;
	git: GitState | null;
	planCandidates: PlanCandidate[];
	suggested: 'recap' | 'plan' | 'explore';
}

/** Suggest a page mode for the current folder: recap, plan or explore. */
export function detect(base?: string | null, cwd = process.cwd()): Detection {
	const root = repoRoot(cwd);
	const g = root ? gitState(root, base) : null;
	const plans = planCandidates(root);
	const suggested =
		g && (g.commitsAhead || g.dirty) && g.changedFiles ? 'recap' : plans.length ? 'plan' : 'explore';
	return { cwd, git: g, planCandidates: plans, suggested };
}

export function collectFiles(root: string, mb: string, areas: Record<string, string>): FileEntry[] {
	const status: Record<string, { status: string; from: string | null }> = {};
	for (const line of lines(git(['diff', '--name-status', '-M', mb], root))) {
		const bits = line.split('\t');
		const s = bits[0][0];
		status[bits[bits.length - 1]] = { status: s, from: s === 'R' ? bits[1] : null };
	}
	const files: FileEntry[] = [];
	for (const line of lines(git(['diff', '--numstat', '-M', mb], root))) {
		const [add, del, ...rest] = line.split('\t');
		let path = rest.join('\t');
		if (path.includes(' => ')) {
			// rename: a/{x => y}/b or x => y
			path = path.replace(/\{([^{}]*) => ([^{}]*)\}/g, '$2');
			path = path.split(' => ').pop()!.replace(/\/\//g, '/');
		}
		const st = status[path] ?? { status: 'M', from: null };
		files.push({
			path,
			add: add !== '-' ? Number(add) : 0,
			del: del !== '-' ? Number(del) : 0,
			status: st.status,
			from: st.from,
			binary: add === '-'
		});
	}
	for (const path of lines(git(['ls-files', '--others', '--exclude-standard'], root))) {
		let n = 0;
		try {
			n = readFileSync(join(root, path), 'utf8').split(/\r?\n/).length;
		} catch {
			n = 0;
		}
		files.push({ path, add: n, del: 0, status: 'A', from: null, untracked: true });
	}
	for (const f of files) [f.area, f.prefix] = areaOf(f.path, areas);
	return files.sort((a, b) =>
		a.area! < b.area! ? -1 : a.area! > b.area! ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0
	);
}

/** Git facts for a recap page: branch, base, commits, and files with `+/-`. */
export function recapFacts(
	root: string,
	base?: string | null,
	areas: Record<string, string> = {}
): RecapFacts {
	const g = gitState(root, base);
	if (!g.mergeBase) throw new Error(`no merge-base between HEAD and '${g.base}'; pass --base`);
	const mb = git(['merge-base', g.base!, 'HEAD'], root).trim();
	const files = collectFiles(root, mb, areas);
	return {
		...g,
		files,
		stats: {
			files: files.length,
			add: files.reduce((s, f) => s + f.add, 0),
			del: files.reduce((s, f) => s + f.del, 0),
			commits: g.commitsAhead
		}
	};
}

export function isDir(p: string): boolean {
	return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

export function isFile(p: string): boolean {
	return existsSync(p) && statSync(p).isFile();
}
