import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, fixture, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', path), 'utf8');
let code;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-comici-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'comici.takecomic.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const SERIES = 'https://takecomic.jp/series/aa08dc5ffd7e6';

describe('Comici', () => {
  it('reads the ranking from the page’s Next.js data, with covers', async () => {
    const { fetchImpl } = fakeFetch([[path('/ranking/manga'), await text('comici/ranking.html')]]);
    const page = await loadSource(code, fetchImpl).popular({ page: 1 });
    assert.ok(page.items.length >= 20);
    assert.match(page.items[0].url, /^https:\/\/takecomic\.jp\/series\/[0-9a-f]+$/);
    assert.ok(page.items[0].title && !page.items[0].title.includes('\\'));
    assert.ok(page.items.filter((item) => item.cover?.startsWith('https://')).length >= page.items.length - 1);
  });

  it('falls back to the update list when the ranking can’t be read', async () => {
    const { fetchImpl } = fakeFetch([
      [path('/ranking/manga'), '<html>changed</html>'],
      [path('/series/list/up/1'), await text('comici/list.html')],
    ]);
    const page = await loadSource(code, fetchImpl).popular({ page: 1 });
    assert.equal(page.items.length, 4);
    assert.equal(page.hasNextPage, true);
  });

  it('lists updates from the plain list page', async () => {
    const { fetchImpl, requests } = fakeFetch([[(url) => url.pathname.startsWith('/series/list/up/'), await text('comici/list.html')]]);
    const page = await loadSource(code, fetchImpl).latest({ page: 2 });
    assert.equal(requests[0].url, 'https://takecomic.jp/series/list/up/2');
    assert.equal(page.items.length, 4);
    assert.match(page.items[0].cover, /^https:\/\//);
  });

  it('searches through the API and leaves out titles marked for adults', async () => {
    const search = await fixture('comici/search.json');
    search.searchResult.series.series[0].isSexualExpression = true;
    const { fetchImpl, requests } = fakeFetch([[path('/api/search'), search]]);
    const page = await loadSource(code, fetchImpl).search('アビス', 1, {});
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'アビス');
    assert.equal(page.items.length, search.searchResult.series.series.length - 1);
  });

  it('lists only chapters open without signing in, numbered by their place in the series', async () => {
    const { fetchImpl } = fakeFetch([
      [path('/api/episodes'), await fixture('comici/episodes.json')],
      [path('/api/series/access'), await fixture('comici/access.json')],
    ]);
    const detail = await loadSource(code, fetchImpl).getDetail(SERIES);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 9]);
    assert.match(detail.chapters[0].url, /^https:\/\/takecomic\.jp\/episodes\/[0-9a-f]+$/);
    assert.ok(detail.authors.length >= 1);
    assert.ok(!detail.description.startsWith('['), 'rich text becomes plain text');
  });

  it('turns each page’s column-by-column tile order into a row-by-row map, and sends the Referer', async () => {
    const contents = await fixture('comici/contents.json');
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.pathname.startsWith('/api/episodes/'), await fixture('comici/episode.json')],
      [path('/api/book/contentsInfo'), (url) => (url.searchParams.get('page-to') === '0' ? { totalPages: contents.totalPages, result: [] } : contents)],
    ]);
    const episode = (await fixture('comici/episode.json')).episode;
    const pages = await loadSource(code, fetchImpl).getPages(`https://takecomic.jp/episodes/${episode.id ?? 'abc123def'}`);
    assert.equal(pages.length, contents.result.length);
    assert.deepEqual(pages[0].headers, { Referer: 'https://takecomic.jp/' });
    const first = [...contents.result].sort((a, b) => a.sort - b.sort)[0];
    const tiles = JSON.parse(first.scramble);
    const rowWise = (i) => (i % 4) * 4 + Math.floor(i / 4);
    assert.equal(pages[0].scramble.align, 1);
    tiles.forEach((tile, place) => assert.equal(pages[0].scramble.map[rowWise(place)], rowWise(tile)));
    assert.equal(new Set(pages[0].scramble.map).size, 16);
    assert.equal(new URL(requests[1].url).searchParams.get('user-id'), '');
  });

  it('says when the site is down for maintenance', async () => {
    const { fetchImpl } = fakeFetch([[() => true, { status: 403, body: '<title>メンテナンス中 | Site</title>' }]]);
    await assert.rejects(loadSource(code, fetchImpl).latest({ page: 1 }), /TakeComic is down for maintenance/);
  });
});
