export * from './types.js';
export {
	buildPage,
	mapToPage,
	validateMap,
	areaOf,
	assignAreas,
	escapeHtml,
	slug,
	MAP_KINDS,
	PLACEHOLDER
} from './core.js';
export {
	renderPage,
	renderMap,
	renderMapFile,
	renderDataFile,
	renderToString,
	readTemplate,
	outputPath,
	openFile,
	TEMPLATE_PATH,
	type RenderOptions,
	type RenderResult
} from './render.js';
export { loadMap, embedAvatars, embedLogos, linkSources, type LoadedMap } from './map.js';
export { buildSkillMap, frontmatter, firstSentence, type SkillMapOptions } from './skillmap.js';
export { findChrome, runChrome, runCheck, pageLayouts } from './chrome.js';
export {
	detect,
	gitState,
	recapFacts,
	collectFiles,
	planCandidates,
	repoRoot,
	portablePath,
	type Detection,
	type PlanCandidate
} from './git.js';
export { parseHunks, resolveHunk } from './hunks.js';
