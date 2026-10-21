import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'liliana', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-liliana-${process.pid}`);
  await build(out);
  sources.manhuaplus = await readFile(join(out, 'sources', 'liliana.manhuaplusorg.js'), 'utf8');
});

const BASE = 'https://manhuaplus.org';
const TITLE = `${BASE}/manga/the-regressed-mercenary-has-a-plan`;

describe('Liliana', () => {
  const routes = async () => [
    [(url) => /^\/(ranking\/week|all-manga|search|filter)\/\d+\/?$/.test(url.pathname), await text('list.html')],
    [(url) => url.pathname === '/filter', await text('filter.html')],
    [(url) => url.pathname === '/manga/the-regressed-mercenary-has-a-plan', await text('detail.html')],
    [(url) => url.pathname.startsWith('/manga/the-regressed-mercenary-has-a-plan/'), await text('reader.html')],
    // The answer has its own `status` field, so it's wrapped for fakeFetch.
    [(url) => url.pathname.startsWith('/ajax/image/list/chap/'), { status: 200, body: JSON.parse(await text('images.json')) }],
  ];

  it('lists the week’s ranking and the latest updates', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.manhuaplus, fetchImpl);
    const page = await source.popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/ranking/week/2`);
    assert.equal(page.items.length, 3);
    assert.match(page.items[0].url, /^https:\/\/manhuaplus\.org\/manga\/[a-z0-9-]+$/);
    assert.match(page.items[0].cover, /^https:\/\/manhuaplus\.org\/uploads\/covers\//);
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 1 });
    assert.equal(requests[1].url, `${BASE}/all-manga/1/?sort=last_update&status=0`);
  });

  it('searches by keyword, and filters by genres to include and leave out, chapter count, status, gender and sort', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.manhuaplus, fetchImpl);
    await source.search('martial', 2, {});
    await source.search('', 1, { filters: { genres: ['4', '87'], notGenres: ['31'], count: '', status: 'completed', gender: 'Boy', sort: 'views' } });
    await source.search('', 3, {});
    assert.deepEqual(requests.map((request) => request.url), [
      `${BASE}/search/2/?keyword=martial`,
      `${BASE}/filter/1/?genres=4%2C87&notGenres=31&status=completed&sex=Boy&sort=views`,
      `${BASE}/filter/3/`,
    ]);
  });

  it('reads its filters from the filter page, with "Any" where the site has no empty choice', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const filters = await loadSource(sources.manhuaplus, fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['genres', 'notGenres', 'count', 'status', 'gender', 'sort']);
    assert.deepEqual(filters[0].options.slice(0, 2), [{ value: '4', label: 'Action' }, { value: '87', label: 'Adaptation' }]);
    assert.deepEqual(filters[2].options[0], { value: '', label: 'Any' });
    assert.equal(filters[5].default, 'default');
  });

  it('reads a title page and its chapters: one per number, oldest first, dated from Unix seconds', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.manhuaplus, fetchImpl).getDetail(`${TITLE}/`);
    assert.equal(detail.title, 'The Regressed Mercenary Has a Plan');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Gold Line (골드행)']);
    assert.deepEqual(detail.genres.slice(0, 3), ['Action', 'Fantasy', 'Drama']);
    assert.match(detail.description, /^Ghislain Perdium, the Mercenary King/);
    assert.match(detail.description, /\n\nAlso known as: 회귀한 용병은 다 계획이 있다; /);
    assert.equal(detail.cover, `${BASE}/uploads/covers/the-regressed-mercenary-has-a-plan.jpg`);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 110, 111]);
    assert.deepEqual(detail.chapters[3], { url: `${TITLE}/chapter-111`, title: 'Chapter 111', number: 111, date: '2026-10-20T13:08:28.000Z' });
  });

  it('reads pages through the chapter id, back in order, without the loading image', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.manhuaplus, fetchImpl).getPages(`${TITLE}/chapter-111`);
    assert.equal(requests[1].url, `${BASE}/ajax/image/list/chap/103429`);
    assert.equal(requests[1].headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(requests[1].headers.Referer, `${TITLE}/chapter-111`);
    assert.equal(pages.length, 3);
    assert.ok(pages.every((page) => page.url.startsWith('https://cdn.manhuaplus.cc/')));
    const order = JSON.parse(await text('images.json')).html.match(/data-index="\d+"> <a href="[^"]+"/g)
      .map((part) => [Number(part.match(/data-index="(\d+)"/)[1]), part.match(/href="([^"]+)"/)[1]])
      .filter(([, href]) => href.startsWith('https://cdn.')).sort((a, b) => a[0] - b[0]).map(([, href]) => href);
    assert.deepEqual(pages.map((page) => page.url), order);
  });
});
