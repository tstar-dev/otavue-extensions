import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const json = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'asurascans', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-asurascans-${process.pid}`);
  await build(out);
  sources.asura = await readFile(join(out, 'sources', 'asurascans.asurascans.js'), 'utf8');
});

const BASE = 'https://asurascans.com';
const API = 'https://api.asurascans.com/api';

describe('Asura Scans', () => {
  const routes = async () => [
    [(url) => url.pathname === '/api/series', await json('series.json')],
    [(url) => url.pathname === '/api/genres', await json('genres.json')],
    [(url) => url.pathname === '/api/series/overgeared', await json('detail.json')],
    [(url) => url.pathname === '/api/series/overgeared/chapters', await json('chapters.json')],
    [(url) => url.pathname === '/api/series/overgeared/chapters/2', await json('tiled.json')],
    [(url) => url.pathname.startsWith('/api/series/overgeared/chapters/'), await json('chapter.json')],
  ];

  it('lists popular and latest series from the API, kept as bare slugs (the site’s links change)', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.asura, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${API}/series?offset=20&limit=20&sort=popular&order=desc`);
    assert.deepEqual(page.items[0], {
      title: 'Overgeared',
      url: `${BASE}/comics/overgeared`,
      cover: page.items[0].cover,
      status: 'ongoing',
    });
    assert.match(page.items[0].cover, /^https:\/\/cdn\.asurascans\.com\/asura-images\/covers\//);
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${API}/series?offset=0&limit=20&sort=latest&order=desc`);
  });

  it('searches with the chosen filters, and offers the API’s genres', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.asura, fetchImpl);
    await source.search('solo', 1, { filters: { sort: 'rating', ascending: true, status: 'completed', type: 'manhwa', genres: ['action', 'murim'], minChapters: '100 ' } });
    const params = Object.fromEntries(new URL(requests[0].url).searchParams);
    assert.deepEqual(params, { offset: '0', limit: '20', search: 'solo', sort: 'rating', order: 'asc', status: 'completed', type: 'manhwa', genres: 'action,murim', min_chapters: '100' });
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'ascending', 'status', 'type', 'genres', 'minChapters']);
    assert.deepEqual(filters[4].options[0], { value: 'action', label: 'Action' });
  });

  it('reads a series from a link with the random suffix, with its free chapters only: one per number, oldest first', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.asura, fetchImpl).getDetail(`${BASE}/comics/overgeared-11fe7da3`);
    assert.deepEqual(requests.map((request) => request.url), [`${API}/series/overgeared`, `${API}/series/overgeared/chapters`]);
    assert.equal(detail.title, 'Overgeared');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres.slice(0, 2), ['Manhwa', 'Action']);
    assert.deepEqual(detail.authors, ['LEE Dong Wook', 'PARK Saenal', 'REDICE Studio']);
    assert.match(detail.description, /^Shin Youngwoo \(a\.k\.a\. Greed\)/);
    assert.match(detail.description, /\n\nAlso known as: 템빨, Grid's Item Peak, /);
    // 346 is premium and 345 is in early access until 2099; 344 is listed twice.
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 0.5, 1, 343, 344]);
    assert.deepEqual(detail.chapters[4], { url: `${BASE}/comics/overgeared/chapter/344`, title: 'Chapter 344 - Saharan vs. Valhalla', number: 344, date: detail.chapters[4].date });
    assert.match(detail.chapters[4].date, /^2026-10-16T/);
  });

  it('reads pages with their sizes', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.asura, fetchImpl).getPages(`${BASE}/comics/overgeared/chapter/340`);
    assert.equal(requests[0].url, `${API}/series/overgeared/chapters/340`);
    assert.equal(pages.length, 3);
    assert.equal(pages[0].width, 1532);
    assert.equal(pages[0].height, 1024);
    assert.equal(pages[0].scramble, undefined);
  });

  it('hands tiled pages to Otavue as a scramble map (tile w belongs at tiles[w])', async () => {
    // Tiles 0, 1, 2 belong at places 1, 2, 0, so places 0, 1, 2 draw tiles 2, 0, 1.
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources.asura, fetchImpl).getPages(`${BASE}/comics/overgeared-11fe7da3/chapter/2`);
    assert.deepEqual(pages[0].scramble, { cols: 4, rows: 5, align: 1, map: [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] });
    assert.equal(pages[1].scramble, undefined);
  });

  it('turns down a tile list that doesn’t cover the grid, rather than show a jumbled page', async () => {
    const broken = { data: { chapter: { pages: [{ url: 'https://cdn.asurascans.com/x.webp', tiles: [0, 1, 2], tile_cols: 4, tile_rows: 5 }] } } };
    const { fetchImpl } = fakeFetch([[() => true, broken]]);
    await assert.rejects(loadSource(sources.asura, fetchImpl).getPages(`${BASE}/comics/overgeared/chapter/3`), /can’t put together/);
  });
});
