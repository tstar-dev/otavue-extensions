import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, fixture, loadSource } from './harness.mjs';

const OUT = join(tmpdir(), `otavue-extensions-gigaviewer-${process.pid}`);
const text = (path) => readFile(join(import.meta.dirname, 'fixtures', path), 'utf8');
let action;
let border;
before(async () => {
  await build(OUT);
  action = await readFile(join(OUT, 'sources', 'gigaviewer.comicaction.js'), 'utf8');
  border = await readFile(join(OUT, 'sources', 'gigaviewer.comicborder.js'), 'utf8');
});

const SERIES = '12207421984154631284';
const graphql = (respond) => [(url) => url.pathname === '/graphql', respond];

describe('GigaViewer', () => {
  it('lists the series of the site’s lists through GraphQL, each once', async () => {
    const { fetchImpl, requests } = fakeFetch([graphql(await fixture('gigaviewer/lists.json'))]);
    const page = await loadSource(action, fetchImpl).popular({ page: 1 });
    assert.equal(page.hasNextPage, false);
    assert.ok(page.items.length > 0 && page.items.length <= 6);
    assert.equal(new Set(page.items.map((item) => item.url)).size, page.items.length);
    assert.match(page.items[0].url, /^https:\/\/comic-action\.com\/series\/\d+$/);
    assert.match(page.items[0].cover, /^https:\/\//);
    assert.equal(requests[0].url, 'https://comic-action.com/graphql');
    assert.equal(requests[0].headers['Content-Type'], 'application/json');
  });

  it('sends list ids as GraphQL node ids, and searches by keyword', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      const body = calls.length === 1 ? await fixture('gigaviewer/lists.json') : await fixture('gigaviewer/search.json');
      const textBody = JSON.stringify(body);
      return { ok: true, status: 200, body: textBody, text: async () => textBody, json: async () => body };
    };
    const source = loadSource(action, fetchImpl);
    await source.latest({ page: 1 });
    assert.match(Buffer.from(calls[0].variables.id0, 'base64').toString(), /^SerialGroup:\d+$/);
    const found = await source.search('サイクル', 1, {});
    assert.equal(calls[1].variables.keyword, 'サイクル');
    assert.ok(Array.isArray(found.items));
  });

  it('lists only free chapters, numbered by their place in the whole series', async () => {
    const products = await fixture('gigaviewer/products-0.json');
    const { fetchImpl } = fakeFetch([
      graphql(await fixture('gigaviewer/series.json')),
      [(url) => url.pathname === '/api/viewer/pagination_readable_products', (url) => (url.searchParams.get('offset') === '0' ? products : [])],
    ]);
    const detail = await loadSource(action, fetchImpl).getDetail(`https://comic-action.com/series/${SERIES}`);
    assert.equal(detail.title, 'サイクル');
    const free = products.filter((p) => p.purchase_info.can_read && !p.purchase_info.unavailable);
    assert.equal(detail.chapters.length, free.length);
    // Newest first from the API, so the oldest episode is number 1.
    const expected = free.map((p) => products.length - products.indexOf(p)).sort((a, b) => a - b);
    assert.deepEqual(detail.chapters.map((c) => c.number), expected);
    assert.match(detail.chapters[0].url, /^https:\/\/comic-action\.com\/episode\/\d+$/);
  });

  it('says so when no chapter is free', async () => {
    const products = (await fixture('gigaviewer/products-0.json')).map((p) => ({ ...p, purchase_info: { ...p.purchase_info, can_read: false } }));
    const { fetchImpl } = fakeFetch([
      graphql(await fixture('gigaviewer/series.json')),
      [(url) => url.pathname === '/api/viewer/pagination_readable_products', (url) => (url.searchParams.get('offset') === '0' ? products : [])],
    ]);
    const detail = await loadSource(action, fetchImpl).getDetail(`https://comic-action.com/series/${SERIES}`);
    assert.deepEqual(detail.chapters, []);
    assert.match(detail.description, /^No chapters are free to read right now\. Comic Action sells the others/);
  });

  it('reads pages from the episode JSON, marking "baku" pages with their tile layout', async () => {
    const { fetchImpl } = fakeFetch([[(url) => url.pathname.startsWith('/episode/'), await text('gigaviewer/episode.html')]]);
    const pages = await loadSource(action, fetchImpl).getPages('https://comic-action.com/episode/12207421984156738902');
    assert.equal(pages.length, 26);
    assert.match(pages[0].url, /^https:\/\/cdn-img\.comic-action\.com\//);
    assert.ok(pages[0].width > 0 && pages[0].height > 0);
    assert.deepEqual(pages[0].scramble, { cols: 4, rows: 4, align: 8, map: [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15] });
    await assert.rejects(loadSource(action, fetchImpl).getPages('https://elsewhere.example/episode/1'), /isn’t a Comic Action chapter link/);
  });

  it('reads Comic Border’s home page for its list, by the series id in each thumbnail', async () => {
    const { fetchImpl } = fakeFetch([[(url) => url.pathname === '/', await text('gigaviewer/border-home.html')]]);
    const page = await loadSource(border, fetchImpl).popular({ page: 1 });
    assert.equal(page.items.length, 3);
    assert.match(page.items[0].url, /^https:\/\/comicborder\.com\/series\/\d+$/);
    assert.ok(page.items[0].title.length > 0 && !page.items[0].title.includes('<'));
  });

  it('offers the site’s collections as a filter', async () => {
    const filters = loadSource(action, async () => { throw new Error('no network'); }).getFilters();
    assert.equal(filters[0].key, 'collection');
    assert.ok(filters[0].options.length >= 2);
    assert.deepEqual(loadSource(border, async () => { throw new Error('no network'); }).getFilters(), []);
  });
});
