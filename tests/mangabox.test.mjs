import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'mangabox', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangabox-${process.pid}`);
  await build(out);
  sources.mangabat = await readFile(join(out, 'sources', 'mangabox.mangabat.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const BASE = 'https://www.mangabats.com';

describe('MangaBox', () => {
  const routes = async () => [
    [(url) => url.pathname.startsWith('/manga-list/') || url.pathname.startsWith('/genre/'), await text('list.html')],
    [path('/home/search/json'), JSON.parse(await text('search.json'))],
    [path('/api/manga/solo-leveling/chapters'), JSON.parse(await text('chapters.json'))],
    [path('/manga/solo-leveling'), await text('detail.html')],
    [(url) => url.pathname.startsWith('/manga/solo-leveling/'), await text('chapter.html')],
  ];

  it('lists hot titles, with covers that need the site as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangabat, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/manga-list/hot-manga?page=2`);
    assert.equal(page.items.length, 3);
    assert.match(page.items[0].url, /^https:\/\/www\.mangabats\.com\/manga\/[a-z0-9-]+$/);
    assert.match(page.items[0].cover, /^https:\/\/img-r\d\.2xstorage\.com\/thumb\//);
    assert.deepEqual(page.items[0].coverHeaders, { Referer: `${BASE}/` });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${BASE}/manga-list/latest-manga?page=1`);
  });

  it('searches through the quick-search JSON, as the site’s change_alias() writes words', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.mangabat, fetchImpl).search('Solo Leveling: Ragnarök!', 1, {});
    assert.equal(new URL(requests[0].url).searchParams.get('searchword'), 'solo_leveling_ragnarok');
    assert.deepEqual(page.items[0], {
      title: 'Solo Leveling',
      url: `${BASE}/manga/solo-leveling`,
      cover: 'https://img-r1.2xstorage.com/thumb/solo-leveling.webp',
      coverHeaders: { Referer: `${BASE}/` },
    });
    assert.equal(page.hasNextPage, false);
  });

  it('browses genres with the sort and status as the site’s filter id', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangabat, fetchImpl);
    await source.search('', 2, { filters: { genre: 'action', sort: 'topview', status: 'completed' } });
    await source.search('', 1, {});
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/genre/action?filter=8&page=2`, `${BASE}/genre/all?filter=4&page=1`]);
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'status', 'genre']);
    assert.ok(filters[2].options.some((option) => option.value === 'action'));
  });

  it('reads a title page, and its chapters from the API: one per number, oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.mangabat, fetchImpl).getDetail(`${BASE}/manga/solo-leveling`);
    assert.equal(detail.title, 'Solo Leveling');
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.authors, ['Chugong', 'Sung-rak Jang', 'Disciples']);
    assert.deepEqual(detail.genres.slice(0, 3), ['Fantasy', 'Action', 'Adventure']);
    assert.match(detail.description, /^Sung Jinwoo, also known as "the weakest hunter of all mankind,"/);
    assert.equal(detail.cover, 'https://img-r1.2xstorage.com/thumb/solo-leveling.webp');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 198, 199, 200]);
    assert.deepEqual(detail.chapters[3], { url: `${BASE}/manga/solo-leveling/chapter-200`, title: 'Chapter 200', number: 200, date: detail.chapters[3].date });
    assert.match(detail.chapters[3].date, /^\d{4}-\d\d-\d\dT/);
  });

  it('builds pages from the reader’s cdns and chapterImages, with the site as Referer', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources.mangabat, fetchImpl).getPages(`${BASE}/manga/solo-leveling/chapter-200`);
    assert.deepEqual(pages.map((page) => page.url), [0, 1, 2].map((n) => `https://img-r1.2xstorage.com/solo-leveling/200/${n}.webp`));
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });

  it('says so when the site answers with a browser check', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, url: `${BASE}/home/search/json`, text: async () => '<title>Just a moment...</title>' });
    await assert.rejects(loadSource(sources.mangabat, fetchImpl).search('x y', 1, {}), /wants a browser check/);
  });
});
