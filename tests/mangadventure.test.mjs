import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'mangadventure', path), 'utf8'));
let source;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangadventure-${process.pid}`);
  await build(out);
  source = await readFile(join(out, 'sources', 'mangadventure.assortedscans.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const B = 'https://assortedscans.com';

describe('MangAdventure', () => {
  const routes = async () => [
    [path('/api/v2/series'), await data('series.json')],
    // The series has its own `status` field, which fakeFetch would read as the HTTP status.
    [path('/api/v2/series/nekotete'), { status: 200, body: await data('detail.json') }],
    [path('/api/v2/series/nekotete/chapters'), await data('chapters.json')],
    [(url) => /^\/api\/v2\/chapters\/\d+\/pages$/.test(url.pathname), await data('pages.json')],
  ];

  it('lists series by views and by latest upload', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const s = loadSource(source, fetchImpl);
    const page = await s.popular({ page: 1 });
    assert.deepEqual(page.items[0], { title: 'Even a Cat\'s Paw Can Be Useful', url: `${B}/reader/nekotete/`, cover: page.items[0].cover, status: null });
    assert.match(page.items[0].cover, /nekotete\/cover\.jpg/);
    assert.equal(page.hasNextPage, true);
    await s.latest({ page: 2 });
    assert.deepEqual(requests.map((request) => new URL(request.url).search), ['?page=1&sort=-views', '?page=2&sort=-latest_upload']);
  });

  it('searches with the API’s own filters', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    await loadSource(source, fetchImpl).search(' cat ', 1, { filters: { author: 'Ono', status: 'completed', sort: 'title', categories: ['Comedy', '4-Koma'] } });
    assert.deepEqual(Object.fromEntries(new URL(requests[0].url).searchParams), { page: '1', title: 'cat', author: 'Ono', status: 'completed', sort: 'title', categories: 'Comedy,4-Koma' });
  });

  it('reads a title and its chapters: one per number, oldest first, with the API id after #', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(source, fetchImpl).getDetail(`${B}/reader/nekotete/`);
    const chapters = (await data('chapters.json')).results;
    assert.equal(detail.title, 'Even a Cat\'s Paw Can Be Useful');
    assert.equal(detail.status, 'ongoing');
    assert.ok(detail.genres.includes('4-Koma'));
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [chapters[3].number, chapters[2].number, chapters[0].number]);
    const newest = detail.chapters[2];
    assert.equal(newest.url, `${B}${chapters[0].url}#${chapters[0].id}`);
    assert.equal(newest.title, chapters[0].full_title);
    assert.equal(newest.date, new Date(Number(chapters[0].published)).toISOString());
  });

  it('reads pages in their numbered order', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(source, fetchImpl).getPages(`${B}/reader/nekotete/2/146/#795`);
    assert.equal(new URL(requests[0].url).pathname, '/api/v2/chapters/795/pages');
    const expected = (await data('pages.json')).results.slice().sort((a, b) => a.number - b.number).map((page) => page.image);
    assert.deepEqual(pages.map((page) => page.url), expected);
  });
});
