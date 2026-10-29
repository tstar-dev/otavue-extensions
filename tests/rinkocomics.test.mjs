import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const BASE = 'https://rinkocomics.com';
let code;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-rinko-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'rinkocomics.rinkocomics.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const card = (slug, title) => `<article class="ac-card"><a class="ac-thumb" href="${BASE}/comic/${slug}/"><img data-src="${BASE}/${slug}.webp"></a><h2 class="ac-title"><a href="${BASE}/comic/${slug}/">${title}</a></h2></article>`;
const chapter = (number, reason = 'free') => `<li class="chapter ${reason === 'free' ? '' : 'locked-chapter'}" data-reason="${reason}" data-permalink="${BASE}/chapter/test-${number}/"><a href="${reason === 'free' ? `${BASE}/chapter/test-${number}/` : '#'}"><span class="chapter-number">Chapter ${number}</span><span class="chapter-date">Oct ${number}, 2026</span></a></li>`;

function recording(routes) {
  const { fetchImpl, requests } = fakeFetch(routes);
  return {
    requests,
    fetchImpl: async (url, opts = {}) => {
      const res = await fetchImpl(url, opts);
      Object.assign(requests.at(-1), { method: opts.method ?? 'GET', body: opts.body ?? null });
      return res;
    },
  };
}

describe('Rinko Comics', () => {
  it('lists the pinned comics as Popular', async () => {
    const home = `<div class="comics-flex-pinned"><a class="pinned-comic-card" href="${BASE}/comic/peach-heart/"><div class="comic-thumbnail"><img data-lazy-src="${BASE}/peach.webp"></div><h3 class="pinned-comic-title">Peach Heart</h3></a></div>`;
    const { fetchImpl } = recording([[path('/'), home]]);
    const page = await loadSource(code, fetchImpl).popular({ page: 1 });
    assert.equal(page.hasNextPage, false);
    assert.equal(page.items.length, 1);
    assert.deepEqual({ ...page.items[0], coverHeaders: undefined }, {
      title: 'Peach Heart', url: `${BASE}/comic/peach-heart/`, cover: `${BASE}/peach.webp`, coverHeaders: undefined,
    });
    assert.equal(page.items[0].coverHeaders.Referer, `${BASE}/`);
  });

  it('lists updates and searches with genres and order', async () => {
    const html = `<div class="ac-grid">${card('frost', 'Frost')}</div><div class="ac-pagination"><a class="next" href="/comic/page/3/">Next</a></div>`;
    const { fetchImpl, requests } = recording([[() => true, html], [() => true, html]]);
    const source = await loadSource(code, fetchImpl);
    const latest = await source.latest({ page: 2 });
    const search = await source.search('young lady’s', 3, { filters: { genres: ['drama', 'romance'], sort: 'az' } });
    assert.equal(latest.items[0].title, 'Frost');
    assert.equal(latest.hasNextPage, true);
    assert.equal(requests[0].url, `${BASE}/comic/page/2/?sort=newest`);
    assert.equal(requests[1].url, `${BASE}/comic/page/3/?post_type=comic&s=young%20lady's&sort=az&genres%5B%5D=drama&genres%5B%5D=romance`);
    assert.equal(search.items.length, 1);
  });

  it('offers the live genre choices and four sort orders', async () => {
    const html = '<div class="ac-filter-group ac-genre"><label><input name="genres[]" value="drama"><span class="ac-option-text">Drama</span></label><label><input name="genres[]" value="romance"><span class="ac-option-text">Romance</span></label></div>';
    const { fetchImpl } = recording([[path('/comic/'), html]]);
    const filters = await loadSource(code, fetchImpl).getFilters();
    assert.deepEqual(filters[0].options, [{ value: 'drama', label: 'Drama' }, { value: 'romance', label: 'Romance' }]);
    assert.deepEqual(filters[1].options.map((option) => option.value), ['newest', 'oldest', 'az', 'za']);
  });

  it('reads details and all free chapters through the load-more endpoint', async () => {
    const detail = `<html><head><meta property="og:image" content="${BASE}/cover.webp"></head><body>
      <div class="comic-info-upper"><h1>Test Comic</h1><div class="comic-graph"><span>A. Writer</span><span>•</span><span>Manhwa</span><span>•</span><span>1,234</span></div></div>
      <div class="comic-status"><span>Status</span><span>ongoing</span></div>
      <div class="comic-genres"><div class="genres"><span class="genre">Drama</span></div></div>
      <div class="alt-titles-list"><span class="alt-title">Test Alt</span></div><div class="comic-synopsis">A synopsis.</div>
      <ul>${chapter(3)}${chapter(2)}${chapter(9, 'paid')}</ul>
      <button id="loadMoreChaptersBtn" data-comic-id="42" data-offset="10"></button>
      <script>var comicworld_ajax = {"ajax_url":"${BASE}/wp-admin/admin-ajax.php","nonce":"abc123"};</script>
    </body></html>`;
    const more = { success: true, data: { html: `${chapter(1)}${chapter(8, 'paid')}` } };
    let ajaxPage = 0;
    const { fetchImpl, requests } = recording([
      [path('/comic/test/'), detail],
      [path('/wp-admin/admin-ajax.php'), () => ajaxPage++ === 0 ? more : { success: true, data: { html: '' } }],
    ]);
    const result = await loadSource(code, fetchImpl).getDetail(`${BASE}/comic/test/`);
    assert.equal(result.title, 'Test Comic');
    assert.equal(result.status, 'ongoing');
    assert.deepEqual(result.authors, ['A. Writer']);
    assert.deepEqual(result.genres, ['Drama', 'Manhwa']);
    assert.equal(result.description, 'A synopsis.\n\nAlso known as: Test Alt');
    assert.deepEqual(result.chapters.map((entry) => entry.number), [1, 2, 3]);
    assert.equal(requests[1].method, 'POST');
    assert.match(requests[1].body, /nonce=abc123/);
    assert.match(requests[1].body, /offset=2/);
    assert.match(requests[2].body, /offset=12/);
  });

  it('reads a free chapter’s lazy-loaded pages with its Referer', async () => {
    const html = `<img class="chapter-image" data-src="https://cdn.rinkocomics.com/01.webp"><img class="chapter-image" src="https://cdn.rinkocomics.com/02.webp">`;
    const { fetchImpl } = recording([[path('/chapter/test-1/'), html]]);
    const pages = await loadSource(code, fetchImpl).getPages(`${BASE}/chapter/test-1/`);
    assert.deepEqual(pages.map((page) => page.url), ['https://cdn.rinkocomics.com/01.webp', 'https://cdn.rinkocomics.com/02.webp']);
    assert.equal(pages[0].headers.Referer, `${BASE}/chapter/test-1/`);
  });
});
