import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'mangareader', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangareader-${process.pid}`);
  await build(out);
  sources.manganow = await readFile(join(out, 'sources', 'mangareader.manganow.js'), 'utf8');
});

const BASE = 'https://manganow.to';
const TITLE = `${BASE}/manga/black-clover`;

describe('MangaReader', () => {
  const routes = async () => [
    [(url) => url.pathname === '/filter/' || url.pathname === '/search', await text('list.html')],
    [(url) => url.pathname === '/manga/black-clover', await text('detail.html')],
    [(url) => url.pathname.startsWith('/manga/black-clover/'), await text('reader.html')],
    // The answer has its own `status` field, so it's wrapped for fakeFetch.
    [(url) => url.pathname.startsWith('/ajax/image/list/'), { status: 202, body: JSON.parse(await text('images.json')) }],
  ];

  it('lists most viewed and latest updated titles through the filter page', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.manganow, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/filter/?sort=most-viewed&page=2`);
    assert.equal(page.items.length, 3);
    assert.match(page.items[0].url, /^https:\/\/manganow\.to\/manga\/[a-z0-9-]+$/);
    assert.ok(page.items[0].title);
    assert.match(page.items[0].cover, /^https:\/\//);
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${BASE}/filter/?sort=latest-updated&page=1`);
  });

  it('searches by keyword, and filters by type, status, score, year, sort and genres otherwise', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.manganow, fetchImpl);
    await source.search('black clover', 2, {});
    await source.search('', 1, { filters: { type: '39', status: 'completed', score: '', year: '2015', sort: 'score', genres: ['1', '17'] } });
    assert.equal(requests[0].url, `${BASE}/search?keyword=black%20clover&page=2`);
    assert.equal(requests[1].url, `${BASE}/filter/?type=39&status=completed&sy=2015&sort=score&genres=1%2C17&page=1`);
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['type', 'status', 'score', 'year', 'sort', 'genres']);
  });

  it('reads a title page and the English chapter list: one per number, oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.manganow, fetchImpl).getDetail(`${TITLE}/`);
    assert.equal(detail.title, 'BLACK CLOVER');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['TABATA Yuuki']);
    assert.deepEqual(detail.genres, ['Action', 'Shounen', 'Fantasy', 'Manga']);
    assert.match(detail.description, /^Asta and Yuno were once abandoned/);
    assert.match(detail.description, /\n\nAlso known as: Black Five Leaf Grass$/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 377, 378]);
    assert.deepEqual(detail.chapters[3], { url: `${TITLE}/chapter-378`, title: 'Chapter 378', number: 378, date: null });
  });

  it('reads pages through the chapter’s reading id, without the site’s banner, with the image host as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.manganow, fetchImpl).getPages(`${TITLE}/chapter-378`);
    assert.equal(requests[0].url, `${TITLE}/chapter-378`);
    assert.equal(requests[1].url, `${BASE}/ajax/image/list/338575?mode=vertical`);
    assert.equal(requests[1].headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(pages.length, 3);
    assert.ok(pages.every((page) => page.url.startsWith('https://www.mangaread.org/wp-content/uploads/')));
    assert.equal(pages[0].headers.Referer, 'https://www.mangaread.org/');
  });

  it('uses a reading id already on the link', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    await loadSource(sources.manganow, fetchImpl).getPages(`${TITLE}/chapter-378#338575`);
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/ajax/image/list/338575?mode=vertical`]);
  });
});
