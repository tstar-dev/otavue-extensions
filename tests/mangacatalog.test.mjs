import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'mangacatalog', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangacatalog-${process.pid}`);
  await build(out);
  for (const id of ['mangacatalog.readsnk', 'mangacatalog.readfairytail', 'mangacatalog.readberserk', 'mangacatalog.readopm', 'mangacatalog.thetowerofgod']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;

describe('MangaCatalog (tailwind)', () => {
  const SNK = 'https://ww12.readsnk.com/manga/shingeki-no-kyojin/';

  it('lists the site’s series, main series first, with covers and no next page', async () => {
    const { fetchImpl, requests } = fakeFetch([]);
    const page = await loadSource(sources['mangacatalog.readsnk'], fetchImpl).popular({ page: 1 });
    assert.equal(page.items[0].title, 'Shingeki No Kyojin');
    assert.equal(page.items[0].url, SNK);
    assert.match(page.items[0].cover, /^https:\/\/i\.imgur\.com\//);
    assert.ok(page.items.length > 5);
    assert.equal(page.hasNextPage, false);
    assert.equal(requests.length, 0);
  });

  it('searches the series list by name, ignoring case and accents', async () => {
    const { fetchImpl } = fakeFetch([]);
    const source = loadSource(sources['mangacatalog.readsnk'], fetchImpl);
    assert.deepEqual((await source.search('LOST girls', 1, {})).items.map((item) => item.title), ['Shingeki no Kyojin – Lost Girls']);
    assert.deepEqual((await source.search('nothing like this', 1, {})).items, []);
  });

  it('reads a title page: its own h1 (not the site header), description, cover and chapters oldest first', async () => {
    const { fetchImpl } = fakeFetch([[path('/manga/shingeki-no-kyojin/'), await text('tailwind-detail.html')]]);
    const detail = await loadSource(sources['mangacatalog.readsnk'], fetchImpl).getDetail(SNK);
    assert.equal(detail.title, 'Shingeki No Kyojin');
    assert.equal(detail.cover, 'https://i.imgur.com/XDcjemc.png');
    assert.match(detail.description, /^Hundreds of years ago, horrifying creatures/);
    assert.doesNotMatch(detail.description, /^Description/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 139, 139.5, 140]);
    assert.deepEqual(detail.chapters[3], {
      url: 'https://ww12.readsnk.com/chapter/shingeki-no-kyojin-chapter-140/',
      title: 'Shingeki No Kyojin Chapter 140',
      number: 140,
      date: null,
    });
  });

  it('opens a link saved on an older host on the current one', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/manga/shingeki-no-kyojin/'), await text('tailwind-detail.html')]]);
    const detail = await loadSource(sources['mangacatalog.readsnk'], fetchImpl).getDetail('https://ww9.readsnk.com/manga/shingeki-no-kyojin/');
    assert.equal(requests[0].url, SNK);
    assert.equal(detail.chapters.length, 4);
  });

  it('refuses a redirect off the site', async () => {
    const fetchImpl = async (url) => ({ ok: true, status: 200, url: 'https://ads.example.com/', text: async () => '<html></html>' });
    await assert.rejects(loadSource(sources['mangacatalog.readsnk'], fetchImpl).getDetail(SNK), /no longer has this/);
  });

  it('reads every page once, in order: plain, lazy (data-src) and <noscript> copies, links trimmed', async () => {
    const { fetchImpl } = fakeFetch([[(url) => url.pathname.startsWith('/chapter/'), await text('tailwind-chapter.html')]]);
    const pages = await loadSource(sources['mangacatalog.readfairytail'], fetchImpl).getPages('https://ww9.readfairytail.com/chapter/fairy-tail-chapter-545.5/');
    assert.deepEqual(pages.map((page) => page.url), [1, 2, 3].map((n) => `https://cdn.readfairytail.com/file/mangap/1166/10545500/${n}.jpeg`));
    assert.deepEqual(pages[0].headers.Referer, 'https://ww9.readfairytail.com/');
  });
});

describe('MangaCatalog (bootstrap)', () => {
  it('reads a title page from its card and table, with dates', async () => {
    const { fetchImpl } = fakeFetch([[path('/manga/berserk/'), await text('bootstrap-detail.html')]]);
    const detail = await loadSource(sources['mangacatalog.readberserk'], fetchImpl).getDetail('https://readberserk.com/manga/berserk/');
    assert.equal(detail.title, 'Berserk');
    assert.equal(detail.cover, 'https://readberserk.com/wp-content/uploads/2017/06/berserk-1-270x300.jpg');
    assert.match(detail.description, /^Guts, a former mercenary now known as the “Black Swordsman,”/);
    assert.match(detail.description, /\n\nSetting out on a dreadful quest/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [384, 385, 386]);
    assert.deepEqual(detail.chapters[2], {
      url: 'https://readberserk.com/chapter/berserk-chapter-386/',
      title: 'Berserk Chapter 386',
      number: 386,
      date: '2026-07-10T00:00:00.000Z',
    });
  });

  it('reads lazy pages from data-src', async () => {
    const { fetchImpl } = fakeFetch([[(url) => url.pathname.startsWith('/chapter/'), await text('bootstrap-chapter.html')]]);
    const pages = await loadSource(sources['mangacatalog.readopm'], fetchImpl).getPages('https://ww7.readopm.com/chapter/one-punch-man-chapter-241/');
    assert.deepEqual(pages.map((page) => page.url.replace(/^.*\//, '')), ['1.png', '2.png', '3.png']);
  });
});

describe('MangaCatalog (single)', () => {
  const TOG = 'https://w82.thetowerofgod.com/';
  const routes = async () => [
    [path('/'), await text('single-home.html')],
    [path('/manga/tower-of-god-chapter-653/'), await text('single-unposted.html')],
    [(url) => url.pathname.startsWith('/manga/tower-of-god-chapter-'), await text('single-chapter.html')],
  ];

  it('lists the one series, read from the home page, leaving out a newest chapter without pages yet', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources['mangacatalog.thetowerofgod'], fetchImpl);
    assert.deepEqual((await source.popular({ page: 1 })).items.map((item) => item.url), [TOG]);
    const detail = await source.getDetail(TOG);
    assert.equal(detail.title, 'Tower of God');
    assert.match(detail.description, /^Tower of God \(Korean:/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [644, 651, 652]);
  });

  it('reads Blogger pages only, each once', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources['mangacatalog.thetowerofgod'], fetchImpl);
    const pages = await source.getPages(`${TOG}manga/tower-of-god-chapter-652/`);
    assert.equal(pages.length, 4);
    assert.ok(pages.every((page) => page.url.startsWith('https://blogger.googleusercontent.com/')));
    await assert.rejects(source.getPages(`${TOG}manga/tower-of-god-chapter-653/`), /no pages/);
  });
});
