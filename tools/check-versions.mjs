// Fails when a source's built file differs from the published one but its version doesn't, so a change
// (to a template, a site entry or a shared lib/ file) can't ship under a version installs already have.
// Run after the build:
//
//   node tools/check-versions.mjs [publishedIndexUrl]
//
// Compares dist/index.json with the published index (default: the GitHub Pages one). Sources only in the
// build are new and fine; ones only in the published index are being removed and fine too.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLISHED = 'https://tstar-dev.github.io/otavue-extensions/index.json';

/** -1, 0 or 1, comparing dotted versions number by number ("1.0.10.1" > "1.0.9.1"). */
export function compareVersions(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** What's wrong with `built` against `published` (both index.json contents), one line per source. */
export function versionProblems(published, built) {
  const before = new Map((published.sources ?? []).map((source) => [source.id, source]));
  const problems = [];
  for (const source of built.sources ?? []) {
    const old = before.get(source.id);
    if (!old) continue;
    const order = compareVersions(source.version, old.version);
    if (order < 0) {
      problems.push(`${source.id}: version went down (${old.version} → ${source.version})`);
    } else if (order === 0 && source.sha256 !== old.sha256) {
      problems.push(`${source.id}: the file changed but the version is still ${source.version} (bump the template's // @version or the site's "version")`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2] ?? PUBLISHED;
  const built = JSON.parse(await readFile(join(ROOT, 'dist', 'index.json'), 'utf8'));
  let published;
  try {
    // A fresh query string gets past GitHub Pages' ~10 minute cache, so a second push right after a first compares with it.
    const fresh = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const res = await fetch(fresh, { signal: AbortSignal.timeout(20_000), headers: { 'Cache-Control': 'no-cache' } });
    // Nothing published yet (a new repository) means nothing to compare with.
    if (res.status === 404) {
      console.log(`No published index at ${url}; nothing to compare.`);
      process.exit(0);
    }
    if (!res.ok) throw new Error(`answered ${res.status}`);
    published = await res.json();
  } catch (error) {
    console.error(`Couldn't read the published index (${url}): ${error.message}`);
    process.exit(1);
  }
  const problems = versionProblems(published, built);
  if (problems.length) {
    console.error(`${problems.length} source(s) would change without a new version:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const changed = built.sources.filter((source) => published.sources?.some((old) => old.id === source.id && old.sha256 !== source.sha256)).length;
  console.log(`Versions OK: ${built.sources.length} sources, ${changed} updated with new versions.`);
}
