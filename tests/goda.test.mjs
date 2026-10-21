import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'goda', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-goda-${process.pid}`);
  await build(out);
  sources.goda = await readFile(join(out, 'sources', 'goda.goda.js'), 'utf8');
});

const BASE = 'https://manhuascans.org';
const LONG = 'shinjiteita-nakama-tachi-ni-dungeon-okuchi-de-korosarekaketa-ga-gift-mugen-gacha-de-level-9999-no-nakama-tachi-wo-te-ni-irete-moto-party-member-to-sekai-ni-fukushuu-and-zamaa-shimasu';

describe('GoDa', () => {
  const routes = async () => [
    [(url) => /^\/(hots|newss|manga-tag|manga-genre)\//.test(url.pathname), await text('list.html')],
    [(url) => url.pathname.startsWith('/s/'), await text('search.html')],
    [(url) => url.pathname === '/manga/get', await text('chapters.html')],
    [(url) => url.pathname === '/chapter/getcontent', await text('content.html')],
    [(url) => url.pathname.startsWith('/manga/'), await text('detail.html')],
  ];

  it('lists hot and new titles, with covers that need the site as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.goda, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/hots/page/2`);
    assert.equal(requests[0].headers.Referer, `${BASE}/`);
    assert.equal(page.items.length, 3);
    assert.match(page.items[0].url, /^https:\/\/manhuascans\.org\/manga\/[a-z0-9-]+$/);
    assert.match(page.items[0].cover, /^https:\/\/all1\.chapt\.top\/encover\//);
    assert.deepEqual(page.items[0].coverHeaders, { Referer: `${BASE}/` });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${BASE}/newss/page/1`);
  });

  it('searches by text, and browses a genre otherwise', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.goda, fetchImpl);
    const page = await source.search('mugen gacha', 2, {});
    await source.search('', 3, { filters: { genre: '/manga-tag/action' } });
    await source.search('', 1, { filters: { genre: '/somewhere-else' } });
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/s/mugen%20gacha?page=2`, `${BASE}/manga-tag/action/page/3`, `${BASE}/hots/page/1`]);
    assert.equal(page.hasNextPage, false);
    const filters = await source.getFilters();
    assert.ok(filters[0].options.some((option) => option.value === '/manga-genre/manhwa'));
  });

  it('cuts a slug that is too long for Otavue at a word, and finds the whole slug again through search', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.goda, fetchImpl);
    const item = (await source.search('shinjiteita', 1, {})).items.find((entry) => entry.url.includes('#'));
    assert.ok(Buffer.byteLength(item.url) <= 150);
    assert.match(item.url, new RegExp(`^${BASE}/manga/shinjiteita-nakama-tachi-ni-[a-z0-9-]+[a-z0-9]#${LONG.length}$`));
    await source.getDetail(item.url);
    assert.match(requests[1].url, /\/s\/shinjiteita%20nakama%20tachi%20ni\?page=1$/);
    assert.equal(requests[2].url, `${BASE}/manga/${LONG}`);
  });

  it('reads a title page and its chapters: one per number, oldest first, dated without a year', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.goda, fetchImpl).getDetail(`${BASE}/manga/the-greatest-estate-developer`);
    assert.equal(detail.title, 'The Greatest Estate Developer');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['MED']);
    assert.deepEqual(detail.genres, ['Manhwa', 'Action', 'Fantasy', 'Adventure', 'Comedy']);
    assert.match(detail.description, /^When civil engineering student Suho Kim/);
    assert.match(detail.cover, /EstateDevCover01\.webp$/);
    assert.equal(requests[1].url, `${BASE}/manga/get?mid=23&mode=all`);
    assert.equal(requests[1].headers.Referer, `${BASE}/`);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 207, 208]);
    assert.equal(detail.chapters[0].url, `${BASE}/manga/the-greatest-estate-developer/2491_1#23/40455`);
    assert.match(detail.chapters[0].date, /^\d{4}-05-17T00:00:00\.000Z$/);
  });

  it('reads pages from the pages endpoint, without the site’s banner, with the site as Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.goda, fetchImpl).getPages(`${BASE}/manga/the-greatest-estate-developer/2491_1#23/40455`);
    assert.equal(requests[0].url, `${BASE}/chapter/getcontent?m=23&c=40455`);
    assert.equal(pages.length, 3);
    assert.ok(pages.every((page) => !page.url.includes('/offer/') && page.url.startsWith('https://all1.chapt.top/comk/')));
    assert.equal(pages[0].headers.Referer, `${BASE}/`);
  });

  it('says so when Cloudflare turns the request away', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, url: `${BASE}/hots/page/1`, text: async () => '<title>Just a moment...</title>' });
    await assert.rejects(loadSource(sources.goda, fetchImpl).popular({ page: 1 }), /wants a browser check/);
  });
});
