// Runs built sources against the live sites: popular → a title → its chapters → a chapter's pages,
// plus latest, search and filters where the source has them. Network required.
//
//   node tools/smoke.mjs [options] [sourceId ...]      (default: every source in dist/index.json)
//
//   --jobs N        check N sites at once (default 1); sources on the same site always run one after another
//   --retry         check each failure once more before counting it (a slow moment shouldn't fail a site)
//   --summary FILE  append a Markdown report (GitHub's $GITHUB_STEP_SUMMARY, for the daily health check)

import { appendFile, readFile } from 'node:fs/promises';
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

async function check(entry, code, log) {
  const source = loadSource(code, bridgeFetch);
  const report = (step, detail) => log(`  ${step.padEnd(9)} ${detail}`);

  const popular = itemsOf(await source.popular({ category: 'sub', dateRange: 7, page: 1 }));
  report('popular', `${popular.length} titles, first: ${popular[0]?.englishTitle ?? popular[0]?.title}`);
  if (popular.length === 0) throw new Error('popular is empty');

  if (source.latest) {
    const latest = itemsOf(await source.latest({ category: 'sub', page: 1 }));
    report('latest', `${latest.length} titles`);
    // Latest only lists titles with something readable, so it's where a readable title is found.
    popular.unshift(...latest.slice(0, 3));
  }

  let read = false;
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
    read = true;
    break;
  }
  if (!read) throw new Error('none of the first titles has a chapter to read');

  const found = itemsOf(await source.search(popular[0].englishTitle ?? popular[0].title, 1, {}));
  report('search', `${found.length} results`);
  if (source.getFilters) report('filters', (await source.getFilters()).map((filter) => filter.key).join(', '));
}

/** One source checked, with its output kept together (sources run side by side with --jobs). */
async function run(entry, code, retry) {
  for (let attempt = 1; ; attempt++) {
    const lines = [`${entry.name} (${entry.id} ${entry.version})${attempt > 1 ? ', second try' : ''}`];
    try {
      await check(entry, code, (line) => lines.push(line));
      return { entry, ok: true, lines };
    } catch (error) {
      // Cloudflare checks datacenter addresses (like CI runners) far more often than phones, so a browser
      // check here says little about the site; it's listed apart and doesn't fail the run.
      const blocked = /wants a browser check/.test(error.message);
      lines.push(`  ${blocked ? 'BLOCKED ' : 'FAILED  '} ${error.message}`);
      if (!retry || attempt > 1) return { entry, ok: false, blocked, error: error.message, lines };
      console.log(lines.join('\n'));
    }
  }
}

/** The site a source talks to (its baseUrl), so sources on one site aren't checked at the same time. */
const siteOf = (entry, code) => /"baseUrl":"([^"]+)"/.exec(code)?.[1] ?? entry.theme;

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const [, value] = args.splice(at, 2);
  return value;
};
const retry = args.includes('--retry') ? (args.splice(args.indexOf('--retry'), 1), true) : false;
const jobs = Math.max(1, Number(option('--jobs') ?? 1));
const summary = option('--summary');
const wanted = args;

const index = JSON.parse(await readFile(join(ROOT, 'dist', 'index.json'), 'utf8'));
const entries = index.sources.filter((source) => wanted.length === 0 || wanted.includes(source.id));
const queues = new Map();
for (const entry of entries) {
  const code = await readFile(join(ROOT, 'dist', entry.file), 'utf8');
  const site = siteOf(entry, code);
  if (!queues.has(site)) queues.set(site, []);
  queues.get(site).push({ entry, code });
}

const results = [];
const sites = [...queues.values()];
async function worker() {
  for (let queue = sites.shift(); queue; queue = sites.shift()) {
    for (const { entry, code } of queue) {
      const result = await run(entry, code, retry);
      console.log(result.lines.join('\n'));
      results.push(result);
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

const byId = (a, b) => a.entry.id.localeCompare(b.entry.id);
const failures = results.filter((result) => !result.ok && !result.blocked).sort(byId);
const blocked = results.filter((result) => result.blocked).sort(byId);
const passed = results.length - failures.length - blocked.length;
console.log(`\n${passed}/${results.length} passed${blocked.length ? `, ${blocked.length} blocked by a browser check` : ''}`);
for (const failure of failures) console.log(`FAILED ${failure.entry.id}: ${failure.error}`);
for (const result of blocked) console.log(`BLOCKED ${result.entry.id}`);
if (summary) {
  const row = (result) => `| ${result.entry.name} | \`${result.entry.id}\` | ${result.error.replace(/\|/g, '\\|')} |`;
  await appendFile(summary, [
    `## Source health: ${passed}/${results.length} passed`,
    '',
    ...(failures.length
      ? ['### Failed', '', '| Source | Id | Failure |', '| --- | --- | --- |', ...failures.map(row), '',
        'Check each by hand before removing it (sites go down for a day). Removed sites go in REMOVED.md.', '']
      : ['Every source that could be reached loaded a list, a title, a chapter and a page image.', '']),
    ...(blocked.length
      ? ['### Couldn’t check (browser check)', '',
        'These answered with a Cloudflare browser check, which sites show to servers like this one far more often than to phones. They don’t fail the run.', '',
        ...blocked.map((result) => `- ${result.entry.name} (\`${result.entry.id}\`)`), '']
      : []),
  ].join('\n'));
}
process.exitCode = failures.length ? 1 : 0;
