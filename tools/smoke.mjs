// Runs built sources against the live sites: popular → a title → its chapters → a chapter's pages,
// plus latest, search and filters where the source has them. Network required.
//
//   node tools/smoke.mjs [sourceId ...]      (default: every source in dist/index.json)

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSource } from '../tests/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Node's fetch in the shape Otavue's bridge hands sources. */
async function bridgeFetch(url, opts = {}) {
  const res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, url: res.url, body: text, text: async () => text, json: async () => JSON.parse(text) };
}

const itemsOf = (value) => (Array.isArray(value) ? value : (value?.items ?? []));

async function check(entry) {
  const code = await readFile(join(ROOT, 'dist', entry.file), 'utf8');
  const source = loadSource(code, bridgeFetch);
  const report = (step, detail) => console.log(`  ${step.padEnd(9)} ${detail}`);
  console.log(`${entry.name} (${entry.id} ${entry.version})`);

  const popular = itemsOf(await source.popular({ category: 'sub', dateRange: 7, page: 1 }));
  report('popular', `${popular.length} titles, first: ${popular[0]?.englishTitle ?? popular[0]?.title}`);
  if (popular.length === 0) throw new Error('popular is empty');

  if (source.latest) {
    const latest = itemsOf(await source.latest({ category: 'sub', page: 1 }));
    report('latest', `${latest.length} titles`);
    // Latest only lists titles with something readable, so it's where a readable title is found.
    popular.unshift(...latest.slice(0, 3));
  }

  for (const item of popular.slice(0, 6)) {
    const detail = await source.getDetail(item.url, {});
    const chapters = detail.chapters?.length ? detail.chapters : await source.getChapters(item.url);
    report('detail', `${detail.englishTitle ?? detail.title}: ${chapters.length} chapters`);
    if (chapters.length === 0) continue;
    const pages = await source.getPages(chapters[chapters.length - 1].url);
    report('pages', `${pages.length} in CH ${chapters[chapters.length - 1].number}, first ${String(pages[0]?.url ?? pages[0]).slice(0, 70)}…`);
    if (pages.length === 0) throw new Error('a chapter with no pages');
    // With the page's own headers (some image hosts check the Referer), as Otavue sends them.
    const image = await fetch(pages[0]?.url ?? pages[0], { method: 'HEAD', headers: pages[0]?.headers ?? {}, signal: AbortSignal.timeout(20_000) });
    report('image', `${image.status} ${image.headers.get('content-type')}`);
    if (!image.ok) throw new Error(`page image answered ${image.status}`);
    break;
  }

  const found = itemsOf(await source.search(popular[0].englishTitle ?? popular[0].title, 1, {}));
  report('search', `${found.length} results`);
  if (source.getFilters) report('filters', (await source.getFilters()).map((filter) => filter.key).join(', '));
}

const index = JSON.parse(await readFile(join(ROOT, 'dist', 'index.json'), 'utf8'));
const wanted = process.argv.slice(2);
let failed = 0;
for (const entry of index.sources.filter((source) => wanted.length === 0 || wanted.includes(source.id))) {
  try {
    await check(entry);
  } catch (error) {
    failed++;
    console.log(`  FAILED   ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
