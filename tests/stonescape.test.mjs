import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const BASE = 'https://stonescape.xyz';
let code;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-stonescape-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'stonescape.stonescape.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const series = (overrides = {}) => ({ title: 'Only See You', slug: 'only-see-you', coverUrl: '/pub/cover.webp', ...overrides });

describe('StoneScape', () => {
  it('lists weekly popular and latest series with exact paging', async () => {
    const { fetchImpl, requests } = fakeFetch([
      [path('/api/series/popular'), { data: [series()], pagination: { page: 1, totalPages: 1 } }],
      [path('/api/series'), { data: [series({ title: 'Latest' })], pagination: { page: 2, totalPages: 3 } }],
    ]);
    const source = loadSource(code, fetchImpl);
    const popular = await source.popular({ page: 1 });
    const latest = await source.latest({ page: 2 });
    assert.equal(popular.hasNextPage, false);
    assert.deepEqual(popular.items[0], {
      title: 'Only See You', url: `${BASE}/series/only-see-you`, cover: `${BASE}/pub/cover.webp`,
      coverHeaders: { Referer: `${BASE}/`, 'User-Agent': popular.items[0].coverHeaders['User-Agent'] },
    });
    assert.equal(latest.hasNextPage, true);
    assert.equal(requests[0].url, `${BASE}/api/series/popular?page=1&period=week&contentType=manhwa&limit=24`);
    assert.equal(requests[1].url, `${BASE}/api/series?page=2&limit=24&contentType=manhwa`);
  });

  it('searches with status and genres, and treats a genre name as a genre query', async () => {
    const { fetchImpl, requests } = fakeFetch([
      [path('/api/series'), { data: [], pagination: { page: 1, totalPages: 1 } }],
      [path('/api/series'), { data: [], pagination: { page: 1, totalPages: 1 } }],
    ]);
    const source = loadSource(code, fetchImpl);
    await source.search('hero', 1, { filters: { status: 'ongoing', genres: ['action', 'fantasy'] } });
    await source.search('School Life', 1, { filters: { genres: [] } });
    assert.equal(requests[0].url, `${BASE}/api/series?page=1&limit=24&contentType=manhwa&status=ongoing&search=hero&genres=action%2Cfantasy`);
    assert.equal(requests[1].url, `${BASE}/api/series?page=1&limit=24&contentType=manhwa&genres=schoollife`);
  });

  it('offers status and the known genre list', async () => {
    const filters = await loadSource(code, async () => { throw new Error('no request expected'); }).getFilters();
    assert.deepEqual(filters[0].options.map((option) => option.value), ['', 'ongoing', 'completed', 'hiatus']);
    assert.ok(filters[1].options.some((option) => option.value === 'post-apocalyptic' && option.label === 'Post-Apocalyptic'));
    assert.ok(filters[1].options.some((option) => option.value === 'schoollife' && option.label === 'School Life'));
  });

  it('reads details and keeps only free published chapters, one per number', async () => {
    const detail = series({
      description: 'A synopsis.', publicationStatus: 'ongoing', author: 'Chaegun', artist: 'Dodge',
      genres: ['schoollife', 'webtoons'],
    });
    const chapter = (number, overrides = {}) => ({
      chapterId: `id-${number}`, chapterNumber: String(number), title: null, createdAt: '2026-10-23T21:21:19.473Z',
      status: 'published', accessMode: 'free', isFreeNow: true, locked: false, ...overrides,
    });
    const { fetchImpl } = fakeFetch([
      [path('/api/series/by-slug/only-see-you'), detail],
      [path('/api/series/by-slug/only-see-you/chapters'), { chapters: [chapter(1), chapter(2), chapter(2), chapter(3, { locked: true }), chapter(4, { accessMode: 'coin' })] }],
    ]);
    const result = await loadSource(code, fetchImpl).getDetail(`${BASE}/series/only-see-you`);
    assert.equal(result.title, 'Only See You');
    assert.equal(result.status, 'ongoing');
    assert.deepEqual(result.authors, ['Chaegun', 'Dodge']);
    assert.deepEqual(result.genres, ['School Life', 'Webtoons']);
    assert.deepEqual(result.chapters.map((entry) => entry.number), [1, 2]);
    assert.equal(result.chapters[1].url, `${BASE}/series/only-see-you/ch-2#id-2`);
  });

  it('reads pages in page-number order, with dimensions, and supports the older images field', async () => {
    const { fetchImpl } = fakeFetch([[path('/api/chapters/ch-1/pages'), {
      pages: [], images: [
        { pageNumber: 2, url: '/pub/02.webp', width: 690, height: 8000 },
        { pageNumber: 1, url: '/pub/01.webp', width: 690, height: 7000 },
      ],
    }]]);
    const pages = await loadSource(code, fetchImpl).getPages(`${BASE}/series/test/ch-1#ch-1`);
    assert.deepEqual(pages.map((page) => page.url), [`${BASE}/pub/01.webp`, `${BASE}/pub/02.webp`]);
    assert.deepEqual([pages[0].width, pages[0].height], [690, 7000]);
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });
});
