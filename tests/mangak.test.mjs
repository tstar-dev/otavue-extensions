import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'mangak', path), 'utf8');
const json = async (path) => JSON.parse(await text(path));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangak-${process.pid}`);
  await build(out);
  sources.mangak = await readFile(join(out, 'sources', 'mangak.mangak.js'), 'utf8');
});

const BASE = 'https://mangak.io';
const API = 'https://api.mangak.io';
const api = (test) => (url) => url.host === 'api.mangak.io' && test(url.pathname);

describe('MangaK', () => {
  const routes = async () => [
    [api((path) => path === '/titles/search'), await json('search.json')],
    [api((path) => path === '/genres'), await json('genres.json')],
    [api((path) => path === '/titles/VYPXzEYz'), await json('title.json')],
    [api((path) => path === '/titles/VYPXzEYz/chapters'), await json('chapters.json')],
    [api((path) => path.startsWith('/titles/VYPXzEYz/chapters/')), await json('chapter.json')],
    [(url) => url.host === 'mangak.io', await text('page.html')],
  ];

  it('lists the week’s popular and the latest titles, with the API id after # and covers that need the site as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangak, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${API}/titles/search?page=2&limit=24&sort=popular&window=week`);
    assert.deepEqual(page.items[0], {
      title: 'Solo Leveling',
      url: `${BASE}/solo-leveling#VYPXzEYz`,
      cover: 'https://rx.resmk.org/covers/c8ccb9d017d6.webp',
      coverHeaders: { Referer: `${BASE}/` },
      status: 'completed',
    });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${API}/titles/search?page=1&limit=24&sort=latest`);
  });

  it('searches with cleaned words and the chosen filters, and offers the site’s genres', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangak, fetchImpl);
    await source.search('Solo Leveling: Ragnarök!', 1, { filters: { genres: ['action', 'adventure'], rating: 'safe', sort: '', demographic: 'shounen,seinen' } });
    const params = Object.fromEntries(new URL(requests[0].url).searchParams);
    assert.deepEqual(params, { page: '1', limit: '24', q: 'Solo Leveling Ragnarök', content_rating: 'safe', demographic: 'shounen,seinen', genres: 'action,adventure' });
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'rating', 'status', 'type', 'demographic', 'genres']);
    assert.deepEqual(filters[5].options[0], { value: 'action', label: 'Action' });
  });

  it('reads a title from the API, with chapters numbered from their names: one per number, oldest first, notices left out', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.mangak, fetchImpl).getDetail(`${BASE}/solo-leveling#VYPXzEYz`);
    assert.equal(requests[0].url, `${API}/titles/VYPXzEYz`);
    assert.match(requests[1].url, /^https:\/\/api\.mangak\.io\/titles\/VYPXzEYz\/chapters\?cv=\d+$/);
    assert.equal(detail.title, 'Solo Leveling');
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.genres.slice(0, 2), ['Action', 'Adventure']);
    assert.equal(detail.genres.at(-1), 'Manhwa');
    assert.ok(detail.authors.some((name) => name.endsWith('(Chugong)')));
    assert.match(detail.description, /^10 years ago, after “the Gate”/);
    assert.match(detail.description, /\n\nAlso known as: Na Honjaman Level-Up, 나 혼자만 레벨업$/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 0.1, 201, 202]);
    assert.deepEqual(detail.chapters[3], { url: `${BASE}/solo-leveling/chapter-202#VYPXzEYz/PDm90OnD`, title: 'Chapter 202', number: 202, date: '2025-01-09T14:03:52.000Z' });
  });

  it('finds the API id on the site’s page for a link without one', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const chapters = await loadSource(sources.mangak, fetchImpl).getChapters(`${BASE}/solo-leveling`);
    assert.equal(requests[0].url, `${BASE}/solo-leveling`);
    assert.equal(chapters.length, 4);
  });

  it('reads pages with their sizes from the API, or from the chapter’s page for a link without ids', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.mangak, fetchImpl);
    const pages = await source.getPages(`${BASE}/solo-leveling/chapter-202#VYPXzEYz/PDm90OnD`);
    assert.equal(requests[0].url, `${API}/titles/VYPXzEYz/chapters/PDm90OnD`);
    assert.equal(pages.length, 3);
    assert.deepEqual({ ...pages[0], headers: undefined }, { url: 'https://rx.qvzrg.org/r/p/1fe3db4a/3b8a26c8/0c78c7b540cd.webp', headers: undefined, width: 760, height: 13820 });
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
    const fallback = await source.getPages(`${BASE}/solo-leveling/chapter-202`);
    assert.equal(requests[1].url, `${BASE}/solo-leveling/chapter-202`);
    assert.equal(fallback.length, 2);
  });

  it('says so when the API doesn’t have a title', async () => {
    const { fetchImpl } = fakeFetch([[() => true, { status: 404, body: { success: false, message: 'Resource not found' } }]]);
    await assert.rejects(loadSource(sources.mangak, fetchImpl).getDetail(`${BASE}/x#abc`), /no longer has this/);
  });
});
