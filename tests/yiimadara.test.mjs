import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'yiimadara', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-yiimadara-${process.pid}`);
  await build(out);
  sources.mangadass = await readFile(join(out, 'sources', 'yiimadara.mangadass.js'), 'utf8');
  sources.mangadna = await readFile(join(out, 'sources', 'yiimadara.mangadna.js'), 'utf8');
});

const BASE = 'https://mangadass.com';
const TITLE = `${BASE}/manga/a-returners-magic-should-be-special`;

describe('YiiMadara', () => {
  const routes = async () => [
    [(url) => url.pathname === '/', await text('home.html')],
    [(url) => url.pathname === '/search' || /^\/(manga|manga-genre\/[a-z-]+|completed|raw-manhwa)\/\d+$/.test(url.pathname), await text('list.html')],
    [(url) => url.pathname === '/manga/a-returners-magic-should-be-special', await text('detail.html')],
    [(url) => url.pathname.startsWith('/manga/a-returners-magic-should-be-special/'), await text('reader.html')],
  ];

  it('lists trending and latest titles, hiding untranslated raws', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangadass, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/manga/2?orderby=trending`);
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((item) => !/raw/i.test(item.title)));
    assert.match(page.items[0].url, /^https:\/\/mangadass\.com\/manga\/[a-z0-9-]+$/);
    assert.match(page.items[0].cover, /^https:\/\/mangadass\.com\/webtoon\/.+m\.jpg$/);
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${BASE}/manga/1`);
  });

  it('keeps raws in the Raw category, and browses genres with a sort', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangadass, fetchImpl);
    const raws = await source.search('', 1, { filters: { category: 'raw-manhwa' } });
    assert.equal(raws.items.length, 3);
    await source.search('', 2, { filters: { genre: 'manga-genre/action', category: 'completed', sort: 'rating' } });
    await source.search('', 1, { filters: { genre: 'https://elsewhere.example/x' } });
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/raw-manhwa/1`, `${BASE}/manga-genre/action/2?orderby=rating`, `${BASE}/manga/1`]);
  });

  it('searches with ’ for apostrophes (the site answers 500 to a plain one)', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    await loadSource(sources.mangadass, fetchImpl).search("A Returner's Magic", 1, {});
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'A Returner’s Magic');
  });

  it('offers the genres linked from the home page, a category and sorts', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const filters = await loadSource(sources.mangadass, fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['genre', 'category', 'sort']);
    assert.deepEqual(filters[0].options.map((option) => option.value), ['', 'manga-genre/action', 'manga-genre/romance', 'manga-genre/smut']);
    assert.deepEqual(filters[1].options.map((option) => option.value), ['', 'completed', 'raw-manhwa']);
  });

  it('reads a title page and its chapters, oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.mangadass, fetchImpl).getDetail(`${TITLE}/`);
    assert.equal(detail.title, 'A Returner\'s Magic Should Be Special');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Yu So Nan', 'Uk Jag Ga']);
    assert.deepEqual(detail.genres, ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Supernatural', 'Manhwa']);
    assert.match(detail.description, /^“Now that I’m back/);
    assert.match(detail.description, /\n\nAlso known as: 귀환자의 마법은/);
    assert.equal(detail.cover, `${BASE}/webtoon/a-returners-magic-should-be-specialm.jpg`);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 268, 269]);
    assert.deepEqual(detail.chapters[3], { url: `${TITLE}/chapter-269`, title: 'Chapter 269', number: 269, date: '2024-07-15T00:00:00.000Z' });
  });

  it('reads every page, though the reader quotes titles with an apostrophe in single quotes', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources.mangadass, fetchImpl).getPages(`${TITLE}/chapter-269`);
    assert.deepEqual(pages.map((page) => page.url.split('/').pop()), ['1-ae660.jpg', '2-ae660.jpg', '3-ae660.jpg', '4-ae660.jpg', '5-ae660.jpg']);
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });

  it('pages the catalogue as /manga/page/<n> where the site does (MangaDNA), and other lists as /<path>/<n>', async () => {
    const { fetchImpl, requests } = fakeFetch([[() => true, await text('list.html')]]);
    const source = loadSource(sources.mangadna, fetchImpl);
    await source.popular({ page: 2 });
    await source.search('', 3, { filters: { category: 'manhwa-raw' } });
    assert.deepEqual(requests.map((request) => request.url), ['https://mangadna.com/manga/page/2?orderby=trending', 'https://mangadna.com/manhwa-raw/3']);
    const filters = await source.getFilters();
    assert.deepEqual(filters.find((filter) => filter.key === 'category').options.map((option) => option.value), ['', 'manhwa-raw']);
  });
});
