/** Card style. See references/schema.md § Map model. */
export type NodeKind =
	| 'public'
	| 'lane'
	| 'external'
	| 'verb'
	| 'script'
	| 'hook'
	| 'board'
	| 'step'
	| (string & {});

export interface MapNodeExample {
	title?: string;
	caption?: string;
	thumb?: string;
	full?: string;
	href?: string;
}

export interface MapNode {
	id: string;
	label?: string;
	kind?: NodeKind;
	sublabel?: string;
	verbs?: string[];
	what?: string;
	when?: string;
	how?: string;
	/** A path (optionally with `:12` or `:12-20`) or a list of them. */
	source?: string | string[];
	opensView?: string;
	author?: string;
	origin?: string;
	credits?: string[];
	external?: boolean;
	emphasis?: boolean;
	change?: 'planned' | (string & {});
	examples?: MapNodeExample[];
	[key: string]: unknown;
}

export interface MapEdge {
	id?: string;
	from: string;
	to: string;
	label?: string;
	when?: string;
	loop?: boolean;
	[key: string]: unknown;
}

export interface MapContainer {
	id: string;
	label?: string;
	nodeIds?: string[];
	parent?: string;
	[key: string]: unknown;
}

export interface MapLane {
	title: string;
	nodeIds: string[];
}

export interface MapIntake {
	label?: string;
	to?: string;
	/** An SVG path relative to the map file; inlined as a data URI on load. */
	logo?: string;
	[key: string]: unknown;
}

export interface MapView {
	id: string;
	parent?: string | null;
	title?: string;
	caption?: string;
	nodeIds: string[];
	/** Edge ids or edge objects. Default: every model edge between the view's nodes. */
	edges?: (string | MapEdge)[];
	render?: 'sequence' | 'process' | (string & {});
	mainSteps?: boolean;
	stepIds?: string[];
	lanes?: MapLane[] | false;
	/** `[col, row]` per node id. Filled in by render when the layout is baked. */
	layout?: Record<string, [number, number]>;
	containers?: MapContainer[];
	browserOrder?: string[];
	nodes?: MapNode[];
	nodeOverrides?: Record<string, Partial<MapNode>>;
	intake?: MapIntake[];
	tour?: string[];
	[key: string]: unknown;
}

export interface MapAuthor {
	name?: string;
	url?: string;
	/** Filled in by render: the GitHub avatar as a data URI. */
	avatar?: string;
	[key: string]: unknown;
}

/** The drill-down map model: shared nodes and edges, and views that each show a subset. */
export interface MapModel {
	title?: string;
	subtitle?: string;
	root?: string;
	sourcesBase?: string;
	authors?: Record<string, MapAuthor>;
	nodes: MapNode[];
	edges: MapEdge[];
	views: MapView[];
	[key: string]: unknown;
}

export type PageKind = 'map' | 'recap' | 'plan' | 'explore' | (string & {});

export interface PageMeta {
	generated?: string;
	project?: string;
	/** The repo root relative to the page, so relative source links resolve. */
	root?: string;
	sourceBase?: string;
	branch?: string;
	base?: string | null;
	commits?: Commit[];
	[key: string]: unknown;
}

/** What the template reads: a map model or a recap/plan/explore page (references/schema.md). */
export interface PageData {
	kind?: PageKind;
	title?: string;
	meta?: PageMeta;
	files?: FileEntry[];
	hunks?: Hunk[];
	areas?: Record<string, string>;
	[key: string]: unknown;
}

export interface Commit {
	sha: string;
	subject: string;
}

export interface GitState {
	root: string;
	branch: string;
	base: string | null;
	mergeBase: string;
	commitsAhead: number;
	commits: Commit[];
	dirty: number;
	changedFiles: number;
	onBase: boolean;
}

export interface FileEntry {
	path: string;
	add: number;
	del: number;
	status: string;
	from?: string | null;
	binary?: boolean;
	untracked?: boolean;
	area?: string;
	prefix?: string;
	note?: string;
	[key: string]: unknown;
}

export interface RecapFacts extends GitState {
	files: FileEntry[];
	stats: { files: number; add: number; del: number; commits: number };
}

export interface HunkLine {
	t: '+' | '-' | ' ';
	o?: number;
	n?: number;
	s: string;
}

export interface HunkNote {
	match?: string;
	at?: number | null;
	[key: string]: unknown;
}

export interface Hunk {
	file: string;
	contains?: string;
	hunk?: number;
	maxLines?: number;
	notes?: HunkNote[];
	header?: string;
	lines?: HunkLine[];
	truncated?: boolean;
	hunkCount?: number;
	missing?: boolean;
	[key: string]: unknown;
}

export interface CheckCounts {
	crossings: number;
	sharedLines: number;
	labelOnLine: number;
	labelOnNode: number;
	lanes: number;
	other: number;
}

export interface CheckResult {
	skipped?: string;
	screenshots?: string[];
	overlaps?: string[];
	counts?: CheckCounts;
	routes?: unknown;
	lanes?: unknown;
	checked?: unknown;
	errors?: string[];
}
