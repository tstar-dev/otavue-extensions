import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const BASE = 'https://silentquill.net';
let code;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-silentquill-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'silentquill.silentquill.js'), 'utf8');
});

const row = (id, value) => `${id}:${JSON.stringify(value)}\n`;
const image = (title, src = '/img/cover') => ['$', 'img', null, { src, alt: title }];
const card = (id, slug, title) => ['$', '$L1', String(id), { href: `/series/${slug}/`, children: image(title) }];
const rsc = (...values) => values.map((value, i) => row((i + 1).toString(16), value)).join('');
const route = (path) => (url) => url.pathname === path;

describe('SilentQuill', () => {
  it('reads the weekly popular RSC grid and keeps long title ids under 150 bytes', async () => {
    const long = 'this-is-a-very-long-series-name-that-keeps-going-with-many-words-and-an-even-longer-ending-to-exceed-the-source-link-limit-safely';
    const body = row('1', ['$', 'div', null, { className: 'grid grid-cols-4 gap-3 md:grid-cols-8', children: [card(42, long, 'Long Story'), '$L2'] }]) + row('2', card(43, 'short-story', 'Short Story'));
    const { fetchImpl } = fakeFetch([[route('/'), body]]);
    const page = await loadSource(code, fetchImpl).popular({ page: 1 });
    assert.equal(page.items[0].title, 'Long Story');
    assert.match(page.items[0].url, /#42$/);
    assert.ok(Buffer.byteLength(page.items[0].url) <= 150);
    assert.equal(page.items[0].cover, `${BASE}/img/cover`);
    assert.equal(page.items[1].title, 'Short Story');
  });

  it('searches with filters, finds paging and powers Latest', async () => {
    const grid = ['$', 'div', null, { className: 'mt-4 grid grid-cols-2 gap-4 lg:grid-cols-6', children: [card(7, 'test', 'Test')] }];
    const next = ['$', 'a', null, { href: '/search/?q=hero&page=3', children: 'Next' }];
    const { fetchImpl, requests } = fakeFetch([[() => true, rsc(grid, next)], [() => true, rsc(grid)]]);
    const source = await loadSource(code, fetchImpl);
    const result = await source.search('hero', 2, { filters: { status: 'ongoing', genre: 'action' } });
    const latest = await source.latest({ page: 1 });
    assert.equal(result.items[0].title, 'Test');
    assert.equal(result.hasNextPage, true);
    assert.equal(latest.items.length, 1);
    assert.equal(requests[0].url, `${BASE}/search/?status=ongoing&genre=action&q=hero&page=2`);
  });

  it('reads the live genre picker from RSC data', async () => {
    const picker = { label: 'Genre', options: [{ value: '', label: 'All genres' }, { value: 'sexual-violence', label: 'Sexual Violence (7)' }] };
    const { fetchImpl } = fakeFetch([[() => true, rsc(picker)]]);
    const filters = await loadSource(code, fetchImpl).getFilters();
    assert.deepEqual(filters[1].options, [{ value: '', label: 'All' }, { value: 'sexual-violence', label: 'Sexual Violence' }]);
  });

  it('reads details and numbers chapters oldest first', async () => {
    const html = `<main><img src="/img/cover"><h1>Test Story</h1><p class="mt-2 text-sm text-ink-dim">A. Writer · art by B. Artist</p>
      <dl><div><dt>Status</dt><dd>Ongoing</dd></div></dl><div class="reader-content">A description.</div>
      <a href="/search/?genre=comedy">Comedy</a><div tabindex="-1">
      <a href="/test-story-chapter-2/"><span>Ch. 2</span><span>2 days</span></a>
      <a href="/test-story-chapter-1/"><span>Ch. 1</span><span>1 month</span></a></div></main>`;
    const { fetchImpl } = fakeFetch([[route('/series/test-story/'), html]]);
    const result = await loadSource(code, fetchImpl).getDetail(`${BASE}/series/test-story/`);
    assert.equal(result.title, 'Test Story');
    assert.equal(result.status, 'ongoing');
    assert.deepEqual(result.authors, ['A. Writer', 'B. Artist']);
    assert.deepEqual(result.genres, ['Comedy']);
    assert.deepEqual(result.chapters.map((chapter) => chapter.number), [1, 2]);
    assert.equal(result.chapters[0].url, `${BASE}/series/test-story/test-story-chapter-1/`);
    assert.ok(result.chapters[0].date);
  });

  it('reads RSC pages with dimensions and image headers', async () => {
    const viewer = { pages: [{ url: '/img/p/1', width: 1115, height: 1600 }], chapterId: 5 };
    const { fetchImpl } = fakeFetch([[() => true, rsc(viewer)]]);
    const pages = await loadSource(code, fetchImpl).getPages(`${BASE}/series/test/test-chapter-1/`);
    assert.deepEqual({ ...pages[0], headers: undefined }, { url: `${BASE}/img/p/1`, width: 1115, height: 1600, headers: undefined });
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });
});
