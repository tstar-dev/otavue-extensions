import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const json = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'hiper', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-hiper-${process.pid}`);
  await build(out);
  sources.hiperdex = await readFile(join(out, 'sources', 'hiper.hiperdex.js'), 'utf8');
});

const BASE = 'https://hiperdex.tv';
const procedure = (name) => (url) => url.pathname === `/api/trpc/${name}`;
/** The JSON input of a recorded tRPC request. */
const inputOf = (request) => JSON.parse(new URL(request.url).searchParams.get('input'))[0].json;

describe('Hiper', () => {
  const routes = async () => [
    [procedure('search.query'), await json('search.json')],
    [procedure('series.bySlugWithGenres'), await json('detail.json')],
    [procedure('series.chapters'), await json('chapters.json')],
    [procedure('reader.chapterPages'), await json('pages.json')],
  ];

  it('lists popular and recent titles through search, with the API key, leaving out novels', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.hiperdex, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].headers['x-cfg-auth'], 'yceqt7qgu004');
    assert.deepEqual(inputOf(requests[0]), { q: '', sort: 'popular', filters: {}, limit: 30, offset: 30, maxRating: 'pornographic' });
    assert.equal(page.items.length, 3);
    assert.deepEqual(page.items[0], {
      title: 'Excuse me, This is my Room',
      url: `${BASE}/manga/excuse-me-this-is-my-room-16524ba3`,
      cover: 'https://cloud-7.r2d2storage.com/2020/08/Excuse-me-This-is-my-Room.webp',
      coverHeaders: { Referer: `${BASE}/` },
      status: 'completed',
    });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(inputOf(requests[1]).sort, 'recent');
  });

  it('searches with only the filters that are set (the API refuses nulls)', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.hiperdex, fetchImpl);
    await source.search('solo', 1, {});
    await source.search('', 1, { filters: { genres: ['Action', 'Murim'], rating: 'safe', type: 'manhwa', status: '', sort: 'score' } });
    assert.deepEqual(inputOf(requests[0]), { q: 'solo', sort: 'relevance', filters: {}, limit: 30, offset: 0, maxRating: 'pornographic' });
    assert.deepEqual(inputOf(requests[1]).filters, { genres: ['Action', 'Murim'], type: 'manhwa', contentRating: 'safe' });
    assert.equal(inputOf(requests[1]).sort, 'score');
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'rating', 'type', 'status', 'genres']);
    assert.equal(filters[4].type, 'multi');
    assert.ok(filters[4].options.some((option) => option.value === 'Murim'));
  });

  it('gets the API’s cookie from the home page after a 401, and sends it back', async () => {
    let calls = 0;
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.pathname === '/', { status: 200, body: '<html></html>', headers: { 'set-cookie': '__st=abc123; Max-Age=259200; Path=/; Expires=Sat, 24 Oct 2026 21:00:12 GMT; HttpOnly' } }],
      [procedure('search.query'), async () => (++calls === 1 ? { status: 401, body: { error: 'Unauthorized: Invalid or missing API Key' } } : await json('search.json'))],
    ]);
    const page = await loadSource(sources.hiperdex, fetchImpl).popular({ page: 1 });
    assert.equal(page.items.length, 3);
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ['/api/trpc/search.query', '/', '/api/trpc/search.query']);
    assert.equal(requests[2].headers.Cookie, '__st=abc123');
  });

  it('reads a title and its published chapters: one per number, oldest first, scheduled and draft ones left out', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.hiperdex, fetchImpl).getDetail(`${BASE}/manga/solo-leveling-ea5e2cf0`);
    assert.deepEqual(inputOf(requests[0]), { slug: 'solo-leveling-ea5e2cf0' });
    assert.deepEqual(inputOf(requests[1]), { seriesId: 8248 });
    assert.equal(detail.title, 'Solo Leveling');
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.genres.slice(-3), ['Supernatural', 'Manhwa', 'Safe']);
    assert.deepEqual(detail.authors.slice(0, 2), ['Chugong', 'H-goon']);
    assert.match(detail.description, /^Ten years ago, "the Gate" appeared/);
    assert.match(detail.description, /\n\nAlso known as: 나혼렙, /);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 1, 199, 200]);
    assert.deepEqual(detail.chapters[3], { url: `${BASE}/manga/solo-leveling-ea5e2cf0/200#316673`, title: 'Chapter 200 Side Story END', number: 200, date: '2026-02-04T04:38:23.000Z' });
  });

  it('reads pages in order with the chapter’s id, with the site as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.hiperdex, fetchImpl).getPages(`${BASE}/manga/solo-leveling-ea5e2cf0/199#316672`);
    assert.deepEqual(inputOf(requests[0]), { seriesSlug: 'solo-leveling-ea5e2cf0', chapterNumber: 199, chapterId: 316672 });
    assert.equal(pages.length, 3);
    assert.match(pages[0].url, /\/01\.webp$/);
    assert.match(pages[2].url, /\/03\.webp$/);
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });

  it('says so when the API refuses or doesn’t have a title', async () => {
    const forbidden = [{ error: { json: { message: 'Use o aplicativo oficial em hiperdex.tv', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } } } }];
    const missing = [{ error: { json: { message: 'Série não encontrada', code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404 } } } }];
    const { fetchImpl } = fakeFetch([
      [procedure('reader.chapterPages'), { status: 403, body: forbidden }],
      [procedure('series.bySlugWithGenres'), { status: 404, body: missing }],
    ]);
    const source = loadSource(sources.hiperdex, fetchImpl);
    await assert.rejects(source.getPages(`${BASE}/manga/x/1`), /Hiperdex answered 403\./);
    await assert.rejects(source.getDetail(`${BASE}/manga/x`), /no longer has this/);
  });
});
