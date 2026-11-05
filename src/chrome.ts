import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CheckResult } from './types.js';

const CHROME_CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	'google-chrome',
	'google-chrome-stable',
	'chromium',
	'chromium-browser'
];

function onPath(cmd: string): boolean {
	const which = process.platform === 'win32' ? 'where' : 'which';
	return spawnSync(which, [cmd], { stdio: 'ignore' }).status === 0;
}

/** The Chrome or Chromium binary to use: `$CHROME_PATH` first, then the usual install spots. */
export function findChrome(): string | null {
	const env = process.env.CHROME_PATH;
	if (env && existsSync(env)) return env;
	for (const c of CHROME_CANDIDATES) if (c.includes('/') || c.includes('\\') ? existsSync(c) : onPath(c)) return c;
	return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run headless Chrome and return its stdout. Headless Chrome on macOS can linger after writing its
 * output, so poll `done(stdout)` and stop it ourselves.
 */
export async function runChrome(
	binary: string,
	args: string[],
	done?: (stdout: string) => boolean,
	timeoutMs = 45_000
): Promise<string> {
	const profile = mkdtempSync(join(tmpdir(), 'nomo-flowchart-chrome-'));
	let out = '';
	try {
		const proc = spawn(
			binary,
			[
				'--headless',
				'--disable-gpu',
				'--hide-scrollbars',
				'--no-first-run',
				'--no-default-browser-check',
				'--mute-audio',
				`--user-data-dir=${profile}`,
				...args
			],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let exited = false;
		proc.on('exit', () => (exited = true));
		proc.on('error', () => (exited = true));
		proc.stdout.setEncoding('utf8');
		proc.stdout.on('data', (c: string) => (out += c));
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs && !exited) {
			if (done?.(out)) {
				await sleep(300);
				break;
			}
			await sleep(250);
		}
		if (!exited) {
			proc.kill('SIGKILL');
			await new Promise((r) => (exited ? r(null) : proc.once('exit', r)));
		}
		return out;
	} finally {
		// Chrome helpers can still write to the profile after the parent exits; retry briefly.
		for (let i = 0; i < 3 && existsSync(profile); i++) {
			try {
				rmSync(profile, { recursive: true, force: true });
			} catch {
				await sleep(100);
			}
		}
	}
}

function unescapeHtml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

interface PageReport {
	overlaps?: string[];
	layouts?: Record<string, Record<string, [number, number]>>;
	childView?: string;
	laneView?: string;
	routes?: unknown;
	lanes?: unknown;
	checked?: unknown;
	errors?: string[];
	error?: string;
}

/** Load the page with `#check=1…` and read the JSON report it writes into `<pre id="visual-check">`. */
async function pageReport(
	binary: string,
	page: string,
	fragment: string,
	timeoutMs?: number
): Promise<PageReport | null> {
	const dom = await runChrome(
		binary,
		[
			'--virtual-time-budget=6000',
			'--window-size=1440,900',
			'--dump-dom',
			pathToFileURL(page).href + '#' + fragment
		],
		(t) => t.includes('</html>'),
		timeoutMs
	);
	const m = /<pre id="visual-check"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
	return m ? (JSON.parse(unescapeHtml(m[1])) as PageReport) : null;
}

/** Let a rendered map search for crossing-free row orders; returns `{viewId: layout}`. */
export async function pageLayouts(page: string, binary = findChrome()): Promise<NonNullable<PageReport['layouts']>> {
	if (!binary) return {};
	const report = await pageReport(binary, page, 'check=1&optimize=1', 600_000);
	return report?.layouts ?? {};
}

/**
 * Check a rendered page in headless Chrome: light and dark screenshots (plus a drilled-in view
 * for a map) and the page's own audit of crossings, shared lines and labels on lines or nodes.
 */
export async function runCheck(
	page: string,
	options: { shots?: string; isMap?: boolean; chrome?: string | null } = {}
): Promise<CheckResult> {
	const binary = options.chrome === undefined ? findChrome() : options.chrome;
	if (!binary) return { skipped: 'no Chrome/Chromium found' };
	const isMap = options.isMap ?? false;
	const report: PageReport = (await pageReport(binary, page, 'check=1&theme=dark')) ?? {
		error: 'page did not report (JS error or no diagrams?)'
	};
	const shots = options.shots ?? join(dirname(page), `.${basename(page, extname(page))}-check`);
	mkdirSync(shots, { recursive: true });
	const size = isMap ? '1440,900' : '1400,2600';
	const plan: [string, string][] = [
		['light', 'theme=light'],
		['dark', 'theme=dark']
	];
	if (isMap && report.childView) plan.push(['drill-dark', `theme=dark&view=${report.childView}`]);
	if (isMap && report.laneView) plan.push(['lanes-light', `theme=light&view=${report.laneView}`]);
	const taken: string[] = [];
	const url = pathToFileURL(page).href;
	for (const [name, frag] of plan) {
		const png = join(shots, `${name}.png`);
		if (existsSync(png)) unlinkSync(png);
		await runChrome(
			binary,
			['--virtual-time-budget=4000', `--window-size=${size}`, `--screenshot=${png}`, `${url}#shot=1&${frag}`],
			() => existsSync(png) && statSync(png).size > 0
		);
		if (existsSync(png)) taken.push(png);
	}
	const ov = report.overlaps ?? [];
	const lane = (o: string) => o.includes('lane "') || o.includes('lanes "');
	const kinds = [' cross', 'share a line', ' lies on edge ', 'covers node', 'overlaps node'];
	const count = (f: (o: string) => boolean) => ov.filter(f).length;
	const result: CheckResult = {
		screenshots: taken,
		overlaps: ov,
		counts: {
			crossings: count((o) => o.includes(' cross') && !lane(o)),
			sharedLines: count((o) => o.includes('share a line')),
			labelOnLine: count((o) => o.includes(' lies on edge ')),
			labelOnNode: count((o) => !lane(o) && (o.includes('covers node') || o.includes('overlaps node'))),
			lanes: count(lane),
			other: count((o) => !lane(o) && !kinds.some((k) => o.includes(k)))
		},
		routes: report.routes,
		lanes: report.lanes,
		checked: report.checked,
		errors: [...(report.errors ?? [])]
	};
	if (report.error) result.errors!.push(report.error);
	return result;
}
