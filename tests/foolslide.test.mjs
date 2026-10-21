import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'foolslide', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-foolslide-${process.pid}`);
  await build(out);
  for (const id of ['foolslide.deathtollscans', 'foolslide.menudofansub', 'foolslide.juinjutsuteamreader']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const starts = (value) => (url) => url.pathname.startsWith(value);
const DT = 'https://reader.deathtollscans.net';

/** fakeFetch, also keeping each request's method and body. */
function recording(routes) {
  const { fetchImpl, requests } = fakeFetch(routes);
  const sent = [];
  return { sent, requests, fetchImpl: (url, opts = {}) => { sent.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body }); return fetchImpl(url, opts); } };
}

describe('FoolSlide', () => {
  const routes = async () => [
    [starts('/directory/'), await text('directory.html')],
    [starts('/search/'), await text('search.html')],
    [starts('/latest/'), await text('latest-mixed.html')],
    [starts('/read/'), await text('chapter.html')],
    [starts('/slide/series/'), await text('series-sub.html')],
    [starts('/series/'), await text('series.html')],
  ];

  it('lists the directory, with full-size covers instead of thumbnails', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const page = await loadSource(sources['foolslide.deathtollscans'], fetchImpl).popular({ page: 2 });
    assert.equal(sent[0].url, `${DT}/directory/2/`);
    assert.deepEqual(page.items[0], {
      title: 'A Diary of Embellished Patches',
      url: `${DT}/series/a_diary_of_embellished_patches/`,
      cover: `${DT}/content/comics/a_diary_of_embellished_patches_5ca0179b2e044/Cover.png`,
    });
    assert.equal(page.items.length, 3);
    assert.equal(page.hasNextPage, true);
  });

  it('searches with the site’s form', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const page = await loadSource(sources['foolslide.deathtollscans'], fetchImpl).search('diver', 1, {});
    assert.deepEqual(sent[0], { url: `${DT}/search/`, method: 'POST', body: 'search=diver' });
    assert.deepEqual(page.items.map((item) => item.title), ['D.Diver']);
  });

  it('reads a title page past the adult warning: info labels, cover and chapters from their links', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const detail = await loadSource(sources['foolslide.deathtollscans'], fetchImpl).getDetail(`${DT}/series/ddiver/`);
    assert.deepEqual(sent[0], { url: `${DT}/series/ddiver/`, method: 'POST', body: 'adult=true' });
    assert.equal(detail.title, 'D.Diver');
    assert.deepEqual(detail.authors, ['MORI Kōji']);
    assert.match(detail.description, /^Kagura Wataru is a young student in law school/);
    assert.match(detail.cover, /^https:\/\/reader\.deathtollscans\.net\/content\/comics\/ddiver_/);
    assert.deepEqual(detail.chapters.map((chapter) => [chapter.number, chapter.date]), [
      [1, '2023-07-01T00:00:00.000Z'], [45, '2026-08-26T00:00:00.000Z'], [46, '2026-10-17T00:00:00.000Z'],
    ]);
    assert.equal(detail.chapters[2].url, `${DT}/read/ddiver/en/6/46/`);
  });

  it('numbers sub-chapters from their links (".../43/1/" is 43.1)', async () => {
    const { fetchImpl } = recording(await routes());
    const detail = await loadSource(sources['foolslide.menudofansub'], fetchImpl).getDetail('https://www.menudo-fansub.com/slide/series/a_channel/');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [41, 42, 43.1]);
    assert.equal(detail.chapters[2].title, 'Chapter 43.1: Extra 1');
  });

  it('reads pages from the reader’s `var pages`', async () => {
    const { fetchImpl } = recording(await routes());
    const pages = await loadSource(sources['foolslide.deathtollscans'], fetchImpl).getPages(`${DT}/read/ddiver/en/6/46/`);
    assert.equal(pages.length, 2);
    assert.match(pages[0].url, /^https:\/\/reader\.deathtollscans\.net\/content\/comics\/ddiver_.*page%2001\.png$/);
    assert.equal(pages[0].headers.Referer, `${DT}/`);
  });

  it('takes Juin Jutsu’s Popular from its latest pages, keeping series and leaving chapter links out', async () => {
    const { fetchImpl, sent } = recording(await routes());
    const source = loadSource(sources['foolslide.juinjutsuteamreader'], fetchImpl);
    assert.equal(source.latest, null);
    const page = await source.popular({ page: 1 });
    assert.equal(sent[0].url, 'https://www.juinjutsureader.ovh/latest/1/');
    assert.deepEqual(page.items.map((item) => item.title), ['Four Knights of Apocalypse - Mokushiroku no Yonkishi', 'One Piece']);
    assert.ok(page.items.every((item) => item.url.includes('/series/')));
    // Its search form answers nothing, so the latest pages are searched instead.
    assert.deepEqual((await source.search('piece', 1, {})).items.map((item) => item.title), ['One Piece']);
  });
});
