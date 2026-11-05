import { join } from 'node:path';
import { git, isFile } from './git.js';
import type { Hunk, HunkLine } from './types.js';

const MAX_HUNK_LINES = 80;

interface ParsedHunk {
	header: string;
	context: string;
	lines: HunkLine[];
}

/** Parse a unified diff into hunks with old/new line numbers. */
export function parseHunks(diff: string): ParsedHunk[] {
	const hunks: ParsedHunk[] = [];
	let cur: ParsedHunk | null = null;
	let old = 0;
	let neu = 0;
	// drop the final newline so it does not read as one more empty context line
	for (const line of diff.replace(/\r?\n$/, '').split(/\r?\n/)) {
		const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
		if (m) {
			old = Number(m[1]);
			neu = Number(m[2]);
			cur = { header: line, context: m[3].trim(), lines: [] };
			hunks.push(cur);
			continue;
		}
		if (!cur || line.startsWith('\\')) continue;
		const sign = line.slice(0, 1) || ' ';
		if (sign === '+') cur.lines.push({ t: '+', n: neu++, s: line.slice(1) });
		else if (sign === '-') cur.lines.push({ t: '-', o: old++, s: line.slice(1) });
		else cur.lines.push({ t: ' ', o: old++, n: neu++, s: line.slice(1) });
	}
	return hunks;
}

function fileDiff(root: string, mb: string, path: string): string {
	const out = git(['diff', '-U3', mb, '--', path], root, false);
	if (out.trim()) return out;
	const p = join(root, path); // untracked: the whole file is the hunk
	if (isFile(p)) return git(['diff', '--no-index', '-U3', '/dev/null', p], root, false, [0, 1]);
	return '';
}

/** Fill a hunk request (`file` + optional `contains`, `hunk`, `maxLines`, `notes`) from git. */
export function resolveHunk(root: string, mb: string, h: Hunk): Hunk {
	if (h.lines?.length) return h;
	const hunks = parseHunks(fileDiff(root, mb, h.file));
	if (!hunks.length) return { ...h, lines: [], missing: true };
	const want = h.contains;
	const picked = want ? hunks.filter((x) => x.lines.some((l) => l.s.includes(want))) : [];
	const chosen = picked.length ? picked[0] : hunks[Number(h.hunk ?? 0) % hunks.length];
	const max = Number(h.maxLines ?? MAX_HUNK_LINES);
	let lines = chosen.lines;
	if (want && picked.length) {
		// centre the window on the first match
		const idx = lines.findIndex((l) => l.s.includes(want));
		const start = Math.max(0, idx - 3);
		lines = lines.slice(start, start + max);
	} else lines = lines.slice(0, max);
	for (const note of h.notes ?? []) {
		const m = note.match;
		const at = m ? lines.findIndex((l) => l.s.includes(m)) : -1;
		note.at = at >= 0 ? at : null;
	}
	return {
		...h,
		header: chosen.header,
		lines,
		truncated: lines.length < chosen.lines.length,
		hunkCount: hunks.length
	};
}
