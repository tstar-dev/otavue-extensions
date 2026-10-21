import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, fixture, loadSource } from './harness.mjs';

let code;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-heancms-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'heancms.luascans.js'), 'utf8');
});

const path = (value) => (url) => url.pathname === value;
const TITLE = 'https://luacomic.org/series/i-need-to-raise-my-sister-properly';
// fakeFetch reads a top-level `status` as the HTTP status, and a series has one of its own.
const json = (body) => ({ status: 200, body });
const lua = async () => [
  [path('/query'), await fixture('heancms/query.json')],
  [path('/series/i-need-to-raise-my-sister-properly'), json(await fixture('heancms/series.json'))],
  [path('/chapter/query'), await fixture('heancms/chapters.json')],
  [path('/chapter/i-need-to-raise-my-sister-properly/chapter-168'), await fixture('heancms/chapter.json')],
  [path('/chapter/i-need-to-raise-my-sister-properly/chapter-169'), await fixture('heancms/chapter-paid.json')],
  [path('/tags'), []],
];

describe('HeanCMS (Lua Scans)', () => {
  it('lists the most viewed comics from the API, sending the site as Origin and Referer', async () => {
    const { fetchImpl, requests } = fakeFetch(await lua());
    const page = await loadSource(code, fetchImpl).popular({ page: 2 });
    const sent = new URL(requests[0].url);
    assert.equal(sent.origin, 'https://api.luacomic.org');
    assert.equal(sent.searchParams.get('orderBy'), 'total_views');
    assert.equal(sent.searchParams.get('page'), '2');
    assert.equal(sent.searchParams.get('series_type'), 'Comic');
    assert.equal(requests[0].headers.Origin, 'https://luacomic.org');
    assert.equal(requests[0].headers.Referer, 'https://luacomic.org/');
    assert.deepEqual(page.items[0], {
      title: 'I Need to Raise My Sister Properly',
      url: TITLE,
      cover: 'https://media.luacomic.org/file/V4IKlhs/oysh4jdz78cza3mqd08i6pih.webp',
      status: 'ongoing',
    });
    assert.equal(page.hasNextPage, true);
  });

  it('sorts Latest by update time on Lua Scans, whose "latest" sort isn’t by date', async () => {
    const { fetchImpl, requests } = fakeFetch(await lua());
    await loadSource(code, fetchImpl).latest({ page: 1 });
    assert.equal(new URL(requests[0].url).searchParams.get('orderBy'), 'updated_at');
  });

  it('searches with a status and sort, and has no genre filter when the site lists no tags', async () => {
    const { fetchImpl, requests } = fakeFetch(await lua());
    const source = loadSource(code, fetchImpl);
    await source.search('sister', 1, { filters: { status: 'Completed', sort: 'title', ascending: true } });
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('query_string'), 'sister');
    assert.equal(params.get('status'), 'Completed');
    assert.equal(params.get('orderBy'), 'title');
    assert.equal(params.get('order'), 'asc');
    assert.deepEqual((await source.getFilters()).map((filter) => filter.key), ['sort', 'ascending', 'status']);
  });

  it('reads a series and its free chapters, leaving out paid ones', async () => {
    const { fetchImpl, requests } = fakeFetch(await lua());
    const detail = await loadSource(code, fetchImpl).getDetail(TITLE);
    assert.equal(detail.title, 'I Need to Raise My Sister Properly');
    assert.equal(detail.status, 'ongoing');
    assert.equal(detail.year, 2023);
    assert.match(detail.description, /Also known as: 언니는 여동생을 바르게 키워야 합니다$/);
    assert.equal(new URL(requests.find((r) => r.url.includes('/chapter/query')).url).searchParams.get('series_id'), '77');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 168]);
    assert.deepEqual(detail.chapters[2], { url: `${TITLE}/chapter-168`, title: 'Chapter 168', number: 168, date: '2026-10-10T14:14:16.302Z' });
  });

  it('leaves out chapters scheduled for later', async () => {
    const chapters = await fixture('heancms/chapters.json');
    chapters.data[1].created_at = '2999-01-01T00:00:00.000Z';
    const routes = (await lua()).map((route) => (route[0](new URL('https://api.luacomic.org/chapter/query')) ? [route[0], chapters] : route));
    const { fetchImpl } = fakeFetch(routes);
    const list = await loadSource(code, fetchImpl).getChapters(TITLE);
    assert.deepEqual(list.map((chapter) => chapter.number), [1, 2]);
  });

  it('lists a chapter’s images, and explains a paid one', async () => {
    const { fetchImpl } = fakeFetch(await lua());
    const source = loadSource(code, fetchImpl);
    const pages = await source.getPages(`${TITLE}/chapter-168`);
    assert.equal(pages.length, 2);
    assert.match(pages[0].url, /^https:\/\/media\.luacomic\.org\/file\/.+\/0001\.webp$/);
    await assert.rejects(source.getPages(`${TITLE}/chapter-169`), /paid on Lua Scans/);
  });
});
