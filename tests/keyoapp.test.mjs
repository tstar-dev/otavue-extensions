import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'keyoapp', path), 'utf8');
const data = async (path) => JSON.parse(await text(path));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-keyoapp-${process.pid}`);
  await build(out);
  for (const id of ['keyoapp.erisscans', 'keyoapp.ritharscans', 'keyoapp.asmotoon']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const param = (name, value) => (url) => (value === undefined ? url.searchParams.has(name) : url.searchParams.get(name) === value);
const HOUR = 3600e3;

describe('Keyoapp (classic)', () => {
  const ERIS = 'https://erisscans.com/series/65e4631f6c7/';
  const classic = async () => [
    [path('/'), await text('classic-home.html')],
    [path('/series/'), await text('classic-series.html')],
    [path('/latest/'), await text('classic-latest.html')],
    [path('/series/65e4631f6c7/'), await text('classic-detail.html')],
    [(url) => url.pathname.startsWith('/chapter/'), await text('classic-chapter.html')],
  ];

  it('lists the featured titles, then the rest of the site’s series, with covers at 480 px', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const page = await loadSource(sources['keyoapp.erisscans'], fetchImpl).popular({ page: 1 });
    assert.deepEqual(page.items.map((item) => item.title), ['Functional Retest', 'A Bloodsucking Romance', 'Balance']);
    assert.deepEqual(page.items[0], {
      title: 'Functional Retest',
      url: ERIS,
      cover: 'https://i0.wp.com/cdn.meowing.org/uploads/65e492b2011.avif?w=480',
      coverHeaders: { Referer: 'https://erisscans.com/' },
    });
    assert.equal(page.hasNextPage, false);
  });

  it('lists latest updates', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const page = await loadSource(sources['keyoapp.erisscans'], fetchImpl).latest({ page: 1 });
    assert.deepEqual(page.items.map((item) => item.title), ['D-Day Romance', 'Functional Retest']);
  });

  it('searches and filters the series list itself, as the site’s page does', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const source = loadSource(sources['keyoapp.erisscans'], fetchImpl);
    assert.deepEqual((await source.search('blood', 1, {})).items.map((item) => item.title), ['A Bloodsucking Romance']);
    const completed = await source.search('', 1, { filters: { status: 'completed', type: 'manhwa' } });
    assert.ok(completed.items.some((item) => item.title === 'Functional Retest'));
    assert.ok(completed.items.every((item) => item.title !== 'A Bloodsucking Romance'));
    assert.deepEqual((await source.search('', 1, { filters: { genres: ['drama', 'psychological'] } })).items.map((item) => item.title), ['Functional Retest']);
  });

  it('offers the genres from the series page’s dropdown', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const filters = await loadSource(sources['keyoapp.erisscans'], fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['type', 'status', 'genres']);
    assert.deepEqual(filters[2].options[0], { value: 'action', label: 'Action' });
  });

  it('reads a title page, leaving out coin chapters', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const detail = await loadSource(sources['keyoapp.erisscans'], fetchImpl).getDetail(ERIS);
    assert.equal(detail.title, 'Functional Retest');
    assert.equal(detail.cover, 'https://i0.wp.com/cdn.meowing.org/uploads/65e492b2011.avif?w=480');
    assert.equal(detail.status, 'completed');
    assert.ok(detail.genres.includes('Romance') && detail.genres.includes('Drama'));
    assert.match(detail.description, /^A seemingly innocent college freshman/);
    assert.match(detail.description, /Also known as: 재기능시험, The Functional Retest/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [2, 3]);
    assert.equal(detail.chapters[1].url, 'https://erisscans.com/chapter/65e4631f6c7-65e47436f72/');
    assert.ok(Math.abs(Date.parse(detail.chapters[1].date) - (Date.now() - 20 * HOUR)) < 60_000);
  });

  it('fills in page images from the page’s realUrl template', async () => {
    const { fetchImpl } = fakeFetch(await classic());
    const pages = await loadSource(sources['keyoapp.erisscans'], fetchImpl).getPages('https://erisscans.com/chapter/65e4631f6c7-65e49f02fc9/');
    assert.deepEqual(pages.map((page) => page.url), ['https://cdn.meowing.org/uploads/65e49f26607.avif', 'https://cdn.meowing.org/uploads/65e49f3420a.avif']);
    assert.equal(pages[0].headers.Referer, 'https://erisscans.com/');
  });

  it('leaves out upcoming chapters and novels', async () => {
    const detail = (await text('classic-detail.html')).replace('title="Chapter 3"', 'title="Chapter 3"><span class="text-sm"><span>Upcoming</span></span><x');
    const home = (await text('classic-home.html')).replace('title="Functional Retest"', 'title="Functional Retest [Novel]"');
    const series = (await text('classic-series.html')).replace('data-type="manhwa"', 'data-type="novel"');
    const { fetchImpl } = fakeFetch([[path('/'), home], [path('/series/'), series], [path('/series/65e4631f6c7/'), detail]]);
    const source = loadSource(sources['keyoapp.erisscans'], fetchImpl);
    assert.deepEqual((await source.getChapters(ERIS)).map((chapter) => chapter.number), [2]);
    assert.ok(!(await source.popular({ page: 1 })).items.some((item) => item.title === 'Functional Retest'));
  });
});

describe('Keyoapp (Livewire search pages)', () => {
  const TITLE = 'https://ritharscans.com/series/3c5afb0a-0f72-4c33-a5fc-2113fdf48d9e';

  it('lists popular titles from /search?sort=popular', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/search'), await text('search-search.html')]]);
    const page = await loadSource(sources['keyoapp.ritharscans'], fetchImpl).popular({ page: 2 });
    assert.equal(requests[0].url, 'https://ritharscans.com/search?sort=popular&page=2');
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].url, TITLE);
    assert.equal(page.items[0].cover, 'https://cdn.ritharscans.com/series/webtoon/3c5afb0a-0f72-4c33-a5fc-2113fdf48d9e/300x450.webp');
    assert.equal(page.hasNextPage, false);
  });

  it('searches by title, with one genre', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/search'), await text('search-search.html')]]);
    await loadSource(sources['keyoapp.ritharscans'], fetchImpl).search('tame', 1, { filters: { sort: 'az', genres: 'action' } });
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('title'), 'tame');
    assert.equal(params.get('sort'), 'az');
    assert.equal(params.get('genre'), 'action');
  });

  it('reads a title page, leaving out coin chapters', async () => {
    const { fetchImpl } = fakeFetch([[(url) => url.pathname.startsWith('/series/'), await text('search-detail.html')]]);
    const detail = await loadSource(sources['keyoapp.ritharscans'], fetchImpl).getDetail(TITLE);
    assert.match(detail.title, /^Geemu Chuuban De Shinu Akuyaku Kizoku/);
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres, ['Japanese', 'Action', 'Comedy']);
    assert.deepEqual(detail.chapters.map((chapter) => [chapter.number, chapter.title]), [[1, 'Chapter 01'], [2, 'Chapter 02']]);
  });

  it('reads pages, with their sizes, from the reader’s JSON.parse(…) string', async () => {
    const { fetchImpl } = fakeFetch([[() => true, await text('search-chapter.html')]]);
    const pages = await loadSource(sources['keyoapp.ritharscans'], fetchImpl).getPages('https://ritharscans.com/read/96035d57-f1bd-4431-a65b-35331a57367c');
    assert.equal(pages.length, 2);
    assert.equal(pages[0].url, 'https://cdn.ritharscans.com/series/webtoon/3c5afb0a-0f72-4c33-a5fc-2113fdf48d9e/chapters/96035d57-f1bd-4431-a65b-35331a57367c/001.jpg');
    assert.equal(pages[0].width, 1115);
    assert.equal(pages[0].height, 1600);
  });

  it('says a chapter is locked when the reader has no pages', async () => {
    const { fetchImpl } = fakeFetch([[() => true, '<div x-data="immersiveReader({ canRead: false })"></div>']]);
    await assert.rejects(loadSource(sources['keyoapp.ritharscans'], fetchImpl).getPages('https://ritharscans.com/read/x'), /locked on RitharScans/);
  });
});

describe('Keyoapp (V2)', () => {
  const TITLE = 'https://asmotoon.com/the-lazy-aristocrat';
  const v2 = async () => [
    [param('_ajax', 'search'), await data('v2-search.json')],
    [param('_ajax', 'recent-chapters'), await text('v2-recent.html')],
    [param('_chapters_html'), await data('v2-chapters.json')],
    [path('/the-lazy-aristocrat'), await text('v2-detail.html')],
    [path('/the-lazy-aristocrat-chapter-1'), await text('v2-chapter.html')],
  ];

  it('lists popular titles from ?_ajax=search, dropping links too long to be Otavue ids', async () => {
    const { fetchImpl, requests } = fakeFetch(await v2());
    const page = await loadSource(sources['keyoapp.asmotoon'], fetchImpl).popular({ page: 3 });
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('sort'), 'popular');
    assert.equal(params.get('offset'), '40');
    assert.deepEqual(page.items, [{
      title: 'The Lazy Aristocrat',
      url: TITLE,
      cover: 'https://wsrv.nl/?url=cdn.meowing.org/uploads/RoIGEtuCQ8_',
      coverHeaders: { Referer: 'https://asmotoon.com/' },
    }]);
    assert.equal(page.hasNextPage, true);
  });

  it('lists recent updates', async () => {
    const { fetchImpl } = fakeFetch(await v2());
    const page = await loadSource(sources['keyoapp.asmotoon'], fetchImpl).latest({ page: 1 });
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].title, 'The Optimal Solution to Eventually Becoming the Mastermind');
    assert.equal(page.hasNextPage, true);
  });

  it('searches with tags, type and status', async () => {
    const { fetchImpl, requests } = fakeFetch(await v2());
    await loadSource(sources['keyoapp.asmotoon'], fetchImpl).search('lazy', 1, { filters: { type: 'manhwa', status: 'ongoing', genres: ['fantasy', 'harem'] } });
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('q'), 'lazy');
    assert.equal(params.get('type'), 'manhwa');
    assert.deepEqual(params.getAll('tag[]'), ['fantasy', 'harem']);
  });

  it('reads a title page and its chapters from ?_chapters_html, leaving out locked ones', async () => {
    const { fetchImpl, requests } = fakeFetch(await v2());
    const detail = await loadSource(sources['keyoapp.asmotoon'], fetchImpl).getDetail(TITLE);
    assert.equal(detail.title, 'The Lazy Aristocrat');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Iko']);
    assert.deepEqual(detail.genres, ['Fantasy', 'Harem']);
    assert.equal(new URL(requests[1].url).searchParams.get('series_slug'), 'the-lazy-aristocrat');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2]);
    assert.equal(detail.chapters[0].date, '2025-02-10T00:00:00.000Z');
  });

  it('lists a chapter’s pages from the strip reader', async () => {
    const { fetchImpl } = fakeFetch(await v2());
    const pages = await loadSource(sources['keyoapp.asmotoon'], fetchImpl).getPages(`${TITLE}-chapter-1`);
    assert.deepEqual(pages.map((page) => page.url), ['https://cdn.meowing.org/uploads/GmIT_kog4n1', 'https://cdn.meowing.org/uploads/01r4B6vpywS']);
  });
});
