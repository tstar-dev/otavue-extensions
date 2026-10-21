import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'iken', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-iken-${process.pid}`);
  await build(out);
  for (const id of ['iken.vortexscans', 'iken.orionscans', 'iken.magusmanga']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const param = (name, value) => (url) => url.searchParams.get(name) === value;
const both = (...tests) => (url) => tests.every((test) => test(url));

describe('Iken', () => {
  const routes = async () => [
    [path('/api/query'), await data('query.json')],
    [path('/api/genres'), await data('genres.json')],
    [both(path('/api/post'), param('postSlug', 'crimson-yaksha')), await data('post.json')],
    [both(path('/api/post'), param('postId', '583')), await data('post.json')],
    [both(path('/api/chapters'), param('postId', '583')), await data('chapters.json')],
    [both(path('/api/chapter'), param('chapterId', '34006')), await data('chapter.json')],
    [both(path('/api/chapter'), param('chapterId', '34274')), await data('chapter-locked.json')],
  ];

  it('lists popular titles from the API with its own Origin, leaving out novels', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources['iken.vortexscans'], fetchImpl).popular({ page: 1 });
    assert.deepEqual(page.items.map((item) => item.title), ['Reality Quest', 'Regressing as the Reincarnated Bastard of the Sword Clan', 'The Legendary Hero is an Academy Honors Student']);
    assert.deepEqual(page.items[0], {
      title: 'Reality Quest',
      url: 'https://vortexscans.org/series/reality-quest-2#94',
      cover: page.items[0].cover,
      status: 'ongoing',
    });
    assert.match(page.items[0].cover, /^https:\/\/storage\.vortexscans\.org\//);
    assert.equal(page.hasNextPage, true);
    const url = new URL(requests[0].url);
    assert.equal(url.origin, 'https://api.vortexscans.org');
    assert.equal(url.searchParams.get('orderBy'), 'totalViews');
    assert.equal(url.searchParams.get('perPage'), '18');
    assert.equal(requests[0].headers.Origin, 'https://vortexscans.org');
  });

  it('sorts latest by the newest chapter, and searches with filters', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources['iken.vortexscans'], fetchImpl);
    await source.latest({ page: 2 });
    assert.equal(new URL(requests[0].url).searchParams.get('orderBy'), 'lastChapterAddedAt');
    assert.equal(new URL(requests[0].url).searchParams.get('page'), '2');
    await source.search(' quest ', 1, { filters: { sort: 'postTitle', ascending: true, status: 'COMPLETED', type: 'MANHWA', genres: ['1', '3'] } });
    const url = new URL(requests[1].url);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      page: '1', perPage: '18', searchTerm: 'quest', orderBy: 'postTitle', orderDirection: 'asc', seriesStatus: 'COMPLETED', seriesType: 'MANHWA', genreIds: '1,3',
    });
  });

  it('offers the API’s genres as a filter', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const filters = await loadSource(sources['iken.vortexscans'], fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'ascending', 'status', 'type', 'genres']);
    assert.deepEqual(filters[4].options[0], { value: '1', label: 'Action' });
  });

  it('reads a title, with free chapters only (from /api/chapters), oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources['iken.vortexscans'], fetchImpl);
    const detail = await source.getDetail('https://vortexscans.org/series/crimson-yaksha#583');
    assert.equal(detail.title, 'Crimson Yaksha');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres, ['Manhwa']);
    assert.deepEqual(detail.authors, []);
    assert.match(detail.description, /^The school-bullying perpetrators died/);
    assert.match(detail.description, /Also known as: 붉은 야차$/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 22, 23]);
    const { date, ...chapter } = detail.chapters[3];
    assert.deepEqual(chapter, { url: 'https://vortexscans.org/series/crimson-yaksha/chapter-23#34006', title: 'Chapter 23', number: 23 });
    assert.match(date, /^2026-10-14T\d\d:\d\d:\d\d/);
    // A plain link from the site, without the id, works too.
    assert.equal((await source.getChapters('https://vortexscans.org/series/crimson-yaksha')).length, 4);
  });

  it('keeps title links within Otavue’s 150 bytes, using the id alone for long slugs', async () => {
    const { fetchImpl } = fakeFetch([[path('/api/query'), await data('orion-query.json')]]);
    const [item] = (await loadSource(sources['iken.orionscans'], fetchImpl).popular({ page: 1 })).items;
    assert.equal(item.url, 'https://orion-scans.com/series/#33');
  });

  it('reads pages in the API’s order, with the site as Referer', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources['iken.vortexscans'], fetchImpl).getPages('https://vortexscans.org/series/crimson-yaksha/chapter-23#34006');
    assert.deepEqual(pages.map((page) => page.url.match(/page-(\d+)/)[1]), ['0001', '0002', '0003']);
    assert.equal(pages[0].headers.Referer, 'https://vortexscans.org/');
    assert.equal(pages[0].width, undefined);
  });

  it('says so when a chapter is locked', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    await assert.rejects(
      loadSource(sources['iken.vortexscans'], fetchImpl).getPages('https://vortexscans.org/series/crimson-yaksha/chapter-24#34274'),
      /locked on Vortex Scans/,
    );
  });

  it('sorts pages by file name where the site asks for it (Magus Manga)', async () => {
    const chapter = await data('chapter.json');
    chapter.chapter.images.forEach((image) => { image.order = 0; });
    chapter.chapter.images.reverse();
    const { fetchImpl } = fakeFetch([[path('/api/chapter'), chapter]]);
    const pages = await loadSource(sources['iken.magusmanga'], fetchImpl).getPages('https://magustoon.org/series/x/chapter-1#1');
    assert.deepEqual(pages.map((page) => page.url.match(/page-(\d+)/)[1]), ['0001', '0002', '0003']);
  });
});
