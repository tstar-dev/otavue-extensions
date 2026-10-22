import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const json = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'hyakuro', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-hyakuro-${process.pid}`);
  await build(out);
  sources.hyakuro = await readFile(join(out, 'sources', 'hyakuro.hyakuro.js'), 'utf8');
});

const BASE = 'https://hyakuro.net';
const LONG = 'the-exiled-cheating-magician-enjoys-a-carefree-second-life-i-can-grant-reinforcement-points-not-only-to-weapons-but-to-anything-and-i-can-revoke-the-effects-at-any-time-i-choose-but-are-those-left-behind-okay';
const params = (request) => Object.fromEntries(new URL(request.url).searchParams);

describe('Hyakuro Translations', () => {
  const routes = async () => [
    [(url) => url.searchParams.has('populate[Chapters][filters][id][$eq]'), await json('pages.json')],
    [(url) => url.searchParams.get('filters[slug][$eq]') === 'boku-wa-kimitachi-wo-shihai-suru', await json('title.json')],
    [(url) => url.searchParams.has('filters[slug][$startsWith]'), await json('long.json')],
    [(url) => url.pathname === '/backend/api/mangas', await json('list.json')],
  ];

  it('lists titles A-Z and by update, with covers from the uploads folder', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.hyakuro, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.deepEqual(params(requests[0]), { populate: 'Cover', sort: 'Title:asc', 'pagination[page]': '2' });
    assert.deepEqual(page.items[0], { title: 'Chou Kasoku Ningen Leo', url: `${BASE}/manga/chou-kasoku-ningen-leo`, cover: page.items[0].cover, status: 'completed' });
    assert.match(page.items[0].cover, /^https:\/\/hyakuro\.net\/backend\/uploads\//);
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(params(requests[1]).sort, 'updatedAt:desc');
  });

  it('searches titles, with the status (or oneshots) and every chosen category', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.hyakuro, fetchImpl);
    await source.search('leo', 1, { filters: { status: 'Oneshot', categories: ['Action', 'Seinen'] } });
    await source.search('', 1, { filters: { status: 'Completed' } });
    assert.deepEqual(params(requests[0]), {
      populate: 'Cover', sort: 'updatedAt:desc', 'pagination[page]': '1', 'filters[Title][$containsi]': 'leo', 'filters[Oneshot][$eq]': 'true',
      'filters[$and][1][Categories][$containsi]': 'Action', 'filters[$and][2][Categories][$containsi]': 'Seinen',
    });
    assert.equal(params(requests[1])['filters[Status][$eq]'], 'Completed');
    assert.equal(params(requests[1])['filters[Title][$containsi]'], undefined);
  });

  it('cuts a slug too long for Otavue at a word, and finds the title again by how it starts and its length', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.hyakuro, fetchImpl);
    const item = (await source.popular({ page: 1 })).items[2];
    assert.ok(Buffer.byteLength(item.url) <= 150);
    assert.match(item.url, new RegExp(`^${BASE}/manga/the-exiled-cheating-magician-[a-z0-9-]+[a-z0-9]#${LONG.length}$`));
    const detail = await source.getDetail(item.url);
    assert.match(detail.title, /^The Exiled Cheating Magician/);
    assert.ok(LONG.startsWith(params(requests[1])['filters[slug][$startsWith]']));
    assert.match(detail.chapters[0].url, new RegExp(`^${BASE}/manga/${LONG}/read/`));
  });

  it('reads a title and its chapters: one per number, oldest first, with the chapter id after #', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.hyakuro, fetchImpl).getDetail(`${BASE}/manga/boku-wa-kimitachi-wo-shihai-suru`);
    assert.equal(detail.title, 'Boku wa Kimitachi wo Shihai suru');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['CHIDA Daisuke']);
    assert.ok(detail.genres.includes('Adult'));
    assert.match(detail.description, /^During a class reunion/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 67]);
    assert.deepEqual(detail.chapters[0], { url: `${BASE}/manga/boku-wa-kimitachi-wo-shihai-suru/read/1/1#37`, title: 'Chapter 1', number: 1, date: '2022-07-19T00:00:00.000Z' });
  });

  it('asks for one chapter’s pages only, and puts them in page order', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.hyakuro, fetchImpl).getPages(`${BASE}/manga/boku-wa-kimitachi-wo-shihai-suru/read/6/1#42`);
    assert.equal(params(requests[0])['populate[Chapters][filters][id][$eq]'], '42');
    assert.deepEqual(pages.map((page) => page.url.match(/Page_(\d+)/)[1]), ['001', '002', '003']);
    assert.equal(pages[0].width, 1125);
    assert.equal(pages[0].height, 1600);
  });

  it('says so when the title is gone', async () => {
    const { fetchImpl } = fakeFetch([[() => true, { data: [], meta: { pagination: { page: 1, pageCount: 0 } } }]]);
    await assert.rejects(loadSource(sources.hyakuro, fetchImpl).getDetail(`${BASE}/manga/nope`), /no longer has this/);
  });
});
