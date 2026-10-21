import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'mangataro', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangataro-${process.pid}`);
  await build(out);
  for (const id of ['mangataro.mangataro', 'mangataro.roliascan']) sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const B = 'https://mangataro.org';

/** fakeFetch, also keeping each request's method and body. */
function recording(routes) {
  const { fetchImpl } = fakeFetch(routes);
  const sent = [];
  return { sent, fetchImpl: (url, opts = {}) => { sent.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body }); return fetchImpl(url, opts); } };
}

describe('MangaTaro', () => {
  const routes = async () => [
    [path('/wp-json/manga/v1/load'), await data('load.json')],
    [path('/auth/search'), await data('search.json')],
    [path('/wp-json/wp/v2/manga/47'), await data('manga.json')],
    [path('/auth/manga-chapters'), await data('chapters.json')],
    [path('/auth/chapter-content'), await data('content.json')],
  ];

  it('lists from /load, with the list filters as JSON strings, leaving out novels and entries without a link', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const page = await loadSource(sources['mangataro.mangataro'], fetchImpl).popular({ page: 1 });
    assert.deepEqual(JSON.parse(sent[0].body), { page: 1, search: '', years: '[]', genres: '[]', types: '[]', statuses: '[]', sort: 'popular_desc', genreMatchMode: 'any' });
    assert.deepEqual(page.items[0], { title: 'One Piece', url: `${B}/manga/one-piece#47`, cover: `${B}/content/media/one-piece.jpg`, status: 'ongoing' });
    assert.equal(page.items.length, 2);
    assert.equal(page.hasNextPage, false);
  });

  it('reads several API pages for one page of Rolia Scan’s Latest', async () => {
    const full = Array.from({ length: 24 }, (_, i) => ({ id: String(i), title: `T${i}`, url: `https://roliascan.com/manga/t${i}/`, type: 'Manhwa' }));
    const { fetchImpl, sent } = recording([[path('/wp-json/manga/v1/load'), full]]);
    const page = await loadSource(sources['mangataro.roliascan'], fetchImpl).latest({ page: 2 });
    assert.deepEqual(sent.map((request) => JSON.parse(request.body).page), [6, 7, 8, 9, 10]);
    assert.equal(JSON.parse(sent[0].body).sort, 'post_desc');
    assert.equal(page.items.length, 24);
    assert.equal(page.hasNextPage, true);
  });

  it('searches with the site’s search box, and filters through /load', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const source = loadSource(sources['mangataro.mangataro'], fetchImpl);
    const page = await source.search(' one piece ', 1, {});
    assert.deepEqual(JSON.parse(sent[0].body), { query: 'one piece', limit: 25 });
    assert.equal(page.items[0].url.split('#')[1], String((await data('search.json')).results[0].id));
    await source.search('', 1, { filters: { sort: 'title', ascending: true, type: 'Manhwa', status: 'Completed', year: '2020' } });
    const body = JSON.parse(sent[1].body);
    assert.deepEqual([body.sort, body.types, body.statuses, body.years], ['title_asc', '["Manhwa"]', '["Completed"]', '[2020]']);
  });

  it('reads a title from WordPress, and its chapters with a valid token: the site’s language only, one per number', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const detail = await loadSource(sources['mangataro.mangataro'], fetchImpl).getDetail(`${B}/manga/one-piece#47`);
    assert.equal(detail.title, 'One Piece');
    assert.equal(detail.cover, `${B}/content/media/one-piece.jpg`);
    assert.deepEqual(detail.genres, ['Action', 'Adventure', 'Fantasy']);
    assert.match(detail.description, /^Gol D\. Roger/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [704, 1195, 1196]);
    assert.equal(detail.chapters[2].title, 'Chapter 1196');
    assert.match(detail.chapters[2].date, /^\d{4}-\d\d-\d\dT/);
    const url = new URL(sent.find((request) => request.url.includes('/auth/manga-chapters')).url);
    const seconds = url.searchParams.get('_ts');
    const hour = new Date(Number(seconds) * 1000).toISOString().replace(/[-T:]/g, '').slice(0, 10);
    assert.equal(url.searchParams.get('_t'), createHash('md5').update(`${seconds}mng_ch_${hour}`).digest('hex').slice(0, 16));
    assert.equal(url.searchParams.get('manga_id'), '47');
  });

  it('retries the chapter list on the server’s clock after a 403', async () => {
    const chapters = await data('chapters.json');
    const stamps = [];
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/wp-json/wp/v2/manga/47') return { ok: true, status: 200, headers: {}, text: async () => JSON.stringify(await data('manga.json')), json: async () => data('manga.json') };
      stamps.push(Number(u.searchParams.get('_ts')));
      if (stamps.length === 1) return { ok: false, status: 403, headers: { date: 'Tue, 01 Jan 2030 00:00:00 GMT' }, text: async () => '', json: async () => ({}) };
      return { ok: true, status: 200, headers: {}, text: async () => JSON.stringify(chapters), json: async () => chapters };
    };
    const detail = await loadSource(sources['mangataro.mangataro'], fetchImpl).getDetail(`${B}/manga/one-piece#47`);
    assert.equal(detail.chapters.length, 3);
    assert.ok(Math.abs(stamps[1] - Date.UTC(2030, 0, 1) / 1000) < 60);
  });

  it('reads pages from the chapter id at the end of its link', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const pages = await loadSource(sources['mangataro.mangataro'], fetchImpl).getPages(`${B}/read/one-piece/ch1196-705184`);
    assert.equal(new URL(sent[0].url).searchParams.get('chapter_id'), '705184');
    assert.equal(pages.length, 3);
    assert.equal(pages[0].headers.Referer, `${B}/`);
  });
});
