import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'yiimanga', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-yiimanga-${process.pid}`);
  await build(out);
  for (const id of ['yiimanga.toongodcc', 'yiimanga.manhwa18tx', 'yiimanga.manhwabuddy', 'yiimanga.manhwaddict']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const starts = (value) => (url) => url.pathname.startsWith(value);

describe('YiiManga', () => {
  const GENIUS = 'https://toongod.cc/webtoon/the-genius-decided-to-live-an-ordinary-life/';

  it('sorts a catalog by views for Popular, and lists the latest from /page/N/', async () => {
    const { fetchImpl, requests } = fakeFetch([[starts('/webtoons/page/'), await text('list.html')], [starts('/page/'), await text('list.html')]]);
    const source = loadSource(sources['yiimanga.toongodcc'], fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, 'https://toongod.cc/webtoons/page/2/?order=views');
    assert.deepEqual(page.items.map((item) => item.title), ['Reality Quest', 'Steel-Eating Player!', page.items[2].title]);
    assert.deepEqual(page.items[0], {
      title: 'Reality Quest',
      url: 'https://toongod.cc/webtoon/reality-quest/',
      cover: 'https://toongod.cc/manga/reality-quest-cover.jpg',
      coverHeaders: { Referer: 'https://toongod.cc/' },
    });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 3 });
    assert.equal(requests[1].url, 'https://toongod.cc/page/3/');
  });

  it('has no separate Latest where Popular already is the latest list', async () => {
    const { fetchImpl, requests } = fakeFetch([[starts('/page/'), await text('list.html')]]);
    const source = loadSource(sources['yiimanga.manhwaddict'], fetchImpl);
    assert.equal(source.latest, null);
    await source.popular({ page: 1 });
    assert.equal(requests[0].url, 'https://manhwaddict.com/page/1/');
  });

  it('takes ManhwaBuddy’s Popular from its home page’s featured row', async () => {
    const { fetchImpl } = fakeFetch([[path('/'), await text('home-featured.html')]]);
    const page = await loadSource(sources['yiimanga.manhwabuddy'], fetchImpl).popular({ page: 1 });
    assert.equal(page.items[0].title, 'Stop Smoking');
    assert.equal(page.items[0].url, 'https://manhwabuddy.com/manhwa/stop-smoking/');
    assert.equal(page.items.length, 3);
    assert.equal(page.hasNextPage, false);
  });

  it('searches with words the site can match: no punctuation, short words or stopwords', async () => {
    const { fetchImpl, requests } = fakeFetch([[starts('/search/'), await text('search.html')]]);
    const page = await loadSource(sources['yiimanga.manhwa18tx'], fetchImpl).search('I’m Being Raised By Villains', 1, {});
    assert.equal(requests[0].url, 'https://manhwa18tx.com/search/?q=Being%20Raised%20Villains&page=1');
    assert.deepEqual(page.items.map((item) => item.url), ['https://manhwa18tx.com/manhwa/im-being-raised-by-villains/']);
  });

  it('searches again with the longest word when every word finds nothing', async () => {
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.searchParams.get('q') === 'Manager', await text('search.html')],
      [starts('/search/'), '<html><body><div class="list"></div></body></html>'],
    ]);
    const page = await loadSource(sources['yiimanga.manhwa18tx'], fetchImpl).search('The Idol Manager’s Diary', 1, {});
    assert.deepEqual(requests.map((request) => new URL(request.url).searchParams.get('q')), ['Idol Manager Diary', 'Manager']);
    assert.equal(page.items.length, 1);
  });

  it('offers the home menu’s genres, and pages them as each site does', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/'), await text('home-menu.html')], [starts('/genre/'), await text('list.html')]]);
    const source = loadSource(sources['yiimanga.toongodcc'], fetchImpl);
    const [filter] = await source.getFilters();
    assert.equal(filter.key, 'genre');
    assert.deepEqual(filter.options[0], { value: '', label: 'All' });
    assert.ok(filter.options.length > 1);
    await source.search('', 1, { filters: { genre: 'romance' } });
    await source.search('', 2, { filters: { genre: 'romance' } });
    assert.deepEqual(requests.slice(1).map((request) => request.url), ['https://toongod.cc/genre/romance/', 'https://toongod.cc/genre/romance/2/']);
  });

  it('reads a title page (main-info layout), chapters oldest first with their dates', async () => {
    const { fetchImpl } = fakeFetch([[starts('/webtoon/'), await text('detail-main.html')]]);
    const detail = await loadSource(sources['yiimanga.toongodcc'], fetchImpl).getDetail(GENIUS);
    assert.equal(detail.title, 'The Genius Decided to Live an Ordinary Life');
    assert.equal(detail.cover, 'https://toongod.cc/manga/the-genius-decided-to-live-an-ordinary-life-cover.jpg');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres, ['Drama', 'Fantasy', 'Slice of Life']);
    assert.deepEqual(detail.authors, ['Jasone', 'Silk Scallop', 'Arty']);
    assert.match(detail.description, /^The protagonist of a successful life/);
    assert.match(detail.description, /\n\nAlso known as: .*천재는 평범하게 살기로 했더/);
    assert.deepEqual(detail.chapters.map((chapter) => [chapter.number, chapter.date]), [
      [1, '2025-01-13T00:00:00.000Z'], [75, '2026-09-30T00:00:00.000Z'], [76, '2026-10-14T00:00:00.000Z'], [77, null],
    ]);
    assert.equal(detail.chapters[3].url, `${GENIUS}chapter-77/`);
  });

  it('reads a title page (manga-detail layout)', async () => {
    const { fetchImpl } = fakeFetch([[starts('/manhwa/'), await text('detail-alt.html')]]);
    const detail = await loadSource(sources['yiimanga.manhwa18tx'], fetchImpl).getDetail('https://manhwa18tx.com/manhwa/affair-agency/');
    assert.equal(detail.title, 'Affair Agency');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres, ['Drama', 'Mature']);
    assert.deepEqual(detail.authors, ['Tass']);
    assert.match(detail.description, /Also known as: 불륜대행 \/ Venta de Amor/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 20, 21, 22]);
    assert.equal(detail.chapters[2].date, '2026-10-13T00:00:00.000Z');
  });

  it('reads a chapter’s pages with the site as Referer', async () => {
    const { fetchImpl } = fakeFetch([[starts('/webtoon/'), await text('chapter.html')]]);
    const pages = await loadSource(sources['yiimanga.toongodcc'], fetchImpl).getPages(`${GENIUS}chapter-77/`);
    assert.deepEqual(pages.map((page) => page.url), [1, 2, 3].map((n) => `https://img01.toongod.cc/chapters/8109/77/${n}-2fc.jpg`));
    assert.equal(pages[0].headers.Referer, 'https://toongod.cc/');
  });

  it('refuses a redirect off the site', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, url: 'https://ads.example.com/', text: async () => '<html></html>' });
    await assert.rejects(loadSource(sources['yiimanga.toongodcc'], fetchImpl).getDetail(GENIUS), /no longer has this/);
  });
});
