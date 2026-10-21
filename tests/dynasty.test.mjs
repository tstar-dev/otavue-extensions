import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'dynasty', path), 'utf8');
const json = async (path) => JSON.parse(await text(path));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-dynasty-${process.pid}`);
  await build(out);
  sources.dynasty = await readFile(join(out, 'sources', 'dynasty.dynasty.js'), 'utf8');
});

const BASE = 'https://dynasty-scans.com';
const SERIES = 'the_guy_she_was_interested_in_wasnt_a_guy_at_all';

describe('Dynasty Scans', () => {
  const routes = async () => [
    [(url) => url.pathname === '/', await text('home.html')],
    [(url) => url.pathname === '/chapters/added.json', await json('added.json')],
    [(url) => url.pathname === '/search', await text('search.html')],
    [(url) => url.pathname === '/tags/suggest', await json('suggest.json')],
    [(url) => url.pathname === `/series/${SERIES}.json`, await json('series.json')],
    [(url) => url.pathname === '/doujins/uma_musume_pretty_derby.json' && url.searchParams.get('page') === '2', await json('doujin-2.json')],
    [(url) => url.pathname === '/doujins/uma_musume_pretty_derby.json', await json('doujin.json')],
    [(url) => url.pathname === '/chapters/poketaki_date.json', await json('single.json')],
    [(url) => url.pathname.startsWith('/chapters/') && url.pathname.endsWith('.json'), await json('chapter.json')],
  ];

  it('lists the week’s most popular chapters as their series, titled from the card (not the permalink)', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.dynasty, fetchImpl).popular({ page: 1 });
    assert.match(requests[0].headers.Accept, /^text\/html/);
    assert.equal(page.items[0].title, "The Guy She Was Interested in Wasn't a Guy At All");
    assert.equal(page.items[0].url, `${BASE}/series/${SERIES}`);
    // Its cover comes from the shipped cover map.
    assert.match(page.items[0].cover, /^https:\/\/dynasty-scans\.com\/system\/tag_contents_covers\/000\//);
    assert.ok(page.items.every((item) => item.title !== 'Not Popular'));
    assert.ok(page.items.some((item) => item.url === `${BASE}/chapters/by_then`));
    assert.equal(page.hasNextPage, false);
  });

  it('lists newly added chapters as their series, or the chapter itself when it stands alone', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.dynasty, fetchImpl).latest({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/chapters/added.json?page=1`);
    assert.deepEqual(page.items.map((item) => item.url.replace(BASE, '')), ['/chapters/poketaki_date', '/series/maou_sama_re_re_revenge', '/series/li_zi_and_nian_nian']);
    assert.equal(page.items[0].cover, null);
    assert.equal(page.hasNextPage, true);
  });

  it('searches with the chosen types only, tags, and an author found by exact name', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.dynasty, fetchImpl);
    const page = await source.search('', 2, { filters: { types: ['Series'], tags: ['5175'], notTags: ['22331'], author: 'saburouta' } });
    assert.equal(requests[0].url, `${BASE}/tags/suggest`);
    const params = new URL(requests[1].url).searchParams;
    assert.deepEqual(params.getAll('classes[]'), ['Series']);
    assert.deepEqual(params.getAll('with[]'), ['5175', '5670']);
    assert.deepEqual(params.getAll('without[]'), ['22331']);
    assert.equal(params.get('sort'), 'released_on');
    assert.equal(params.get('page'), '2');
    assert.ok(page.items.every((item) => item.url.includes('/series/')));
    assert.equal(page.hasNextPage, true);
    await assert.rejects(source.search('', 1, { filters: { author: 'Nobody At All' } }), /No author on Dynasty Scans is called "Nobody At All"/);
  });

  it('offers sort, types, tags in and out, and the name filters', async () => {
    const filters = await loadSource(sources.dynasty, fakeFetch([]).fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'types', 'tags', 'notTags', 'author', 'scanlator', 'pairing']);
    assert.equal(filters[1].default.length, 5);
    assert.ok(filters[2].options.length > 300);
  });

  it('reads a series: volume headers in titles, extras just after the chapter before them, one per number', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.dynasty, fetchImpl).getDetail(`${BASE}/chapters/${SERIES}_ch183`);
    assert.equal(detail.title, "The Guy She Was Interested in Wasn't a Guy At All");
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Arai Sumiko']);
    assert.match(detail.cover, /\/system\/tag_contents_covers\/000\/018\/949\/medium\//);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 9, 9.1, 9.11, 183]);
    assert.equal(detail.chapters[3].title, 'Volume 1 Moonlight Magazine Spring Edition');
    assert.deepEqual(detail.chapters[4], { url: `${BASE}/chapters/${SERIES}_ch183`, title: 'Volume 5 Chapter 183: Family Call', number: 183, date: '2026-10-18T00:00:00.000Z' });
  });

  it('reads a doujin collection across its pages, its works numbered in release order with their authors', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources.dynasty, fetchImpl).getDetail(`${BASE}/doujins/uma_musume_pretty_derby`);
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/doujins/uma_musume_pretty_derby.json`, `${BASE}/doujins/uma_musume_pretty_derby.json?page=2`]);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 3]);
    assert.match(detail.chapters[0].title, /^Gold Ship and McQueen by /);
    assert.match(detail.chapters[2].title, /^GoruMeno Development by Coconuts/);
  });

  it('reads a single release as a title with one chapter', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.dynasty, fetchImpl).getDetail(`${BASE}/chapters/poketaki_date`);
    assert.equal(detail.title, 'poketaki date');
    assert.equal(detail.status, 'completed');
    assert.equal(detail.chapters.length, 1);
    assert.equal(detail.chapters[0].url, `${BASE}/chapters/poketaki_date`);
    assert.match(detail.cover, /^https:\/\/dynasty-scans\.com\/system\/releases\//);
  });

  it('reads a chapter’s pages', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.dynasty, fetchImpl).getPages(`${BASE}/chapters/${SERIES}_ch183`);
    assert.equal(requests[0].url, `${BASE}/chapters/${SERIES}_ch183.json`);
    assert.deepEqual(pages.map((page) => page.url.split('/').pop()), ['01.webp', '02.webp', '03.webp']);
  });
});
