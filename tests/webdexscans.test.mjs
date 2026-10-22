import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const json = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'webdexscans', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-webdexscans-${process.pid}`);
  await build(out);
  sources.webdex = await readFile(join(out, 'sources', 'webdexscans.webdexscans.js'), 'utf8');
});

const BASE = 'https://webdexscans.com';
const REST = 'https://nrqghtbdrdnoywxjkgkf.supabase.co/rest/v1';
const params = (request) => Object.fromEntries(new URL(request.url).searchParams);
const SERIES = '1424cfb4-fe65-475c-87fd-42877aa8fc84';

describe('Webdex Scans', () => {
  const routes = async () => [
    [(url) => url.pathname === '/rest/v1/series' && url.searchParams.get('slug') === 'eq.legend-of-star-general', await json('series.json')],
    [(url) => url.pathname === '/rest/v1/series', { status: 200, body: await json('series-list.json'), headers: { 'content-range': '24-26/52' } }],
    [(url) => url.pathname === '/rest/v1/chapters', await json('chapters.json')],
    [(url) => url.pathname === '/rest/v1/pages', await json('pages.json')],
    [(url) => url.pathname === '/rest/v1/genres', await json('genres.json')],
  ];

  it('lists popular and latest series through PostgREST with the anon key, covers straight from the CDN', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.webdex, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(new URL(requests[0].url).origin + new URL(requests[0].url).pathname, `${REST}/series`);
    assert.deepEqual(params(requests[0]), { select: 'id,title,slug,cover_url', order: 'view_count.desc', offset: '24', limit: '24' });
    assert.match(requests[0].headers.apikey, /^eyJ/);
    assert.equal(requests[0].headers.authorization, `Bearer ${requests[0].headers.apikey}`);
    assert.equal(requests[0].headers.Prefer, 'count=exact');
    assert.deepEqual(page.items[0], {
      title: 'Legend of Star General',
      url: `${BASE}/series/legend-of-star-general`,
      cover: 'https://cdn.webdexscans.com/2023/06/Legend-Of-Star-General-cover-image-e1772038336721.webp',
    });
    // 24 + 3 of 52.
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(params(requests[1]).order, 'updated_at.desc');
  });

  it('searches titles with the genre (through the join), type, status and sort', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.webdex, fetchImpl);
    await source.search('star, general', 1, { filters: { genre: 'action', type: 'manhua', status: 'ongoing', sort: 'a-z' } });
    assert.deepEqual(params(requests[0]), {
      select: 'id,title,slug,cover_url,genres!inner(slug)', 'genres.slug': 'eq.action', title: 'ilike.*star  general*',
      type: 'eq.manhua', status: 'eq.ongoing', order: 'title.asc', offset: '0', limit: '24',
    });
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'genre', 'type', 'status']);
    assert.deepEqual(filters[1].options[1], { value: 'action', label: 'Action' });
  });

  it('reads a series and its free chapters: premium ones only once their free_at has passed', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.webdex, fetchImpl).getDetail(`${BASE}/series/legend-of-star-general`);
    assert.equal(params(requests[1]).series_id, `eq.${SERIES}`);
    assert.equal(detail.title, 'Legend of Star General');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres.slice(0, 2), ['Manhua', 'Action']);
    assert.deepEqual(detail.authors, ['乐想动漫']);
    assert.match(detail.description, /^Song Yunxiang, the last Star Soul General/);
    // 398 is premium until 2099 and 399 has no free date; 397's ended in 2020; 1 is listed twice.
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 396, 397]);
    assert.match(detail.chapters[0].url, new RegExp(`^${BASE}/series/legend-of-star-general/chapter-01#[0-9a-f-]{36}$`));
  });

  it('reads pages by the chapter id after #, from the CDN', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.webdex, fetchImpl).getPages(`${BASE}/series/legend-of-star-general/chapter-01#5e374c6c-77da-49c2-8c93-1d76c1b211f3`);
    assert.deepEqual(params(requests[0]), { chapter_id: 'eq.5e374c6c-77da-49c2-8c93-1d76c1b211f3', select: 'image_url,page_number', order: 'page_number.asc' });
    assert.deepEqual(pages.map((page) => page.url.split('/').pop()), ['01.jpg', '02.jpg', '03.jpg']);
    assert.ok(pages.every((page) => page.url.startsWith('https://cdn.webdexscans.com/WP-manga/')));
  });

  it('finds a chapter’s id by its slug for a link without one, and turns down a locked chapter', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources.webdex, fetchImpl);
    const locked = [[(url) => url.pathname === '/rest/v1/chapters', [{ id: 'x', is_premium: true, free_at: '2099-01-01T00:00:00Z' }]], ...(await routes())];
    await assert.rejects(loadSource(sources.webdex, fakeFetch(locked).fetchImpl).getPages(`${BASE}/series/legend-of-star-general/chapter-398`), /isn’t free to read/);
    const pages = await source.getPages(`${BASE}/series/legend-of-star-general/chapter-01`);
    assert.equal(pages.length, 3);
  });
});
