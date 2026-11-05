#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runCheck } from './chrome.js';
import { detect, recapFacts, repoRoot } from './git.js';
import { renderDataFile, renderMapFile } from './render.js';
import { buildSkillMap } from './skillmap.js';

const USAGE = `nomo-flowchart: interactive flowchart pages from JSON

  nomo-flowchart render --map MAP.json [--out PATH] [--no-open] [--no-check] [--no-optimize]
                        [--no-avatars] [--source-base URL [--source-root DIR]] [--shots DIR]
  nomo-flowchart render DATA.json [--out PATH] [--no-open] [--no-check] [--shots DIR]
  nomo-flowchart skillmap SKILLS_DIR [--deep] [--out MAP.json]
  nomo-flowchart check PAGE.html [--shots DIR]
  nomo-flowchart detect [--base REF]
  nomo-flowchart facts [--base REF]

render prints {out, bytes, missingHunks, check} and exits 2 when the check finds overlaps.
See references/schema.md for the map and data formats.`;

const print = (v: unknown) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');

async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
		process.stdout.write(USAGE + '\n');
		return cmd ? 0 : 1;
	}
	const { values: o, positionals: pos } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			map: { type: 'string' },
			out: { type: 'string' },
			shots: { type: 'string' },
			base: { type: 'string' },
			'source-base': { type: 'string' },
			'source-root': { type: 'string' },
			'no-open': { type: 'boolean' },
			'no-check': { type: 'boolean' },
			'no-optimize': { type: 'boolean' },
			'no-avatars': { type: 'boolean' },
			deep: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' }
		}
	});
	if (o.help) {
		process.stdout.write(USAGE + '\n');
		return 0;
	}

	switch (cmd) {
		case 'detect':
			print(detect(o.base));
			return 0;
		case 'facts': {
			const root = repoRoot();
			if (!root) throw new Error('not inside a git repository');
			print(recapFacts(root, o.base));
			return 0;
		}
		case 'render': {
			const opts = {
				out: o.out,
				shots: o.shots,
				open: !o['no-open'],
				check: !o['no-check'],
				optimize: !o['no-optimize'],
				avatars: !o['no-avatars'],
				sourceBase: o['source-base'],
				sourceRoot: o['source-root']
			};
			let r;
			if (o.map) r = await renderMapFile(o.map, opts);
			else if (pos[0]) r = await renderDataFile(pos[0], opts);
			else throw new Error('render needs DATA.json or --map MAP.json');
			const { data: _data, ...result } = r;
			print(result);
			return r.check?.overlaps?.length ? 2 : 0;
		}
		case 'skillmap': {
			if (!pos[0]) throw new Error('skillmap needs SKILLS_DIR');
			const model = buildSkillMap(pos[0], { deep: o.deep });
			const text = JSON.stringify(model, null, 2);
			if (o.out) {
				mkdirSync(dirname(resolve(o.out)), { recursive: true });
				writeFileSync(o.out, text + '\n');
				process.stdout.write(
					JSON.stringify({
						out: resolve(o.out),
						nodes: model.nodes.length,
						edges: model.edges.length,
						views: model.views.length
					}) + '\n'
				);
			} else process.stdout.write(text + '\n');
			return 0;
		}
		case 'check': {
			if (!pos[0]) throw new Error('check needs PAGE.html');
			const page = resolve(pos[0]);
			const html = readFileSync(page, 'utf8');
			const isMap = html.includes('"kind": "map"') || html.includes('"kind":"map"');
			const res = await runCheck(page, { shots: o.shots, isMap });
			print(res);
			return res.overlaps?.length || res.errors?.length ? 2 : 0;
		}
		default:
			process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`);
			return 1;
	}
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(err: Error) => {
		process.stderr.write((err?.message ?? String(err)) + '\n');
		process.exit(1);
	}
);
