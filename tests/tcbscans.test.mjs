import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'tcbscans', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-tcbscans-${process.pid}`);
  await build(out);
  sources.tcb = await readFile(join(out, 'sources', 'tcbscans.tcbscans.js'), 'utf8');
});

const BASE = 'https://tcbonepiecechapters.com';

describe('TCB Scans', () => {
  const routes = async () => [
    [(url) => url.pathname === '/projects', await text('projects.html')],
    [(url) => url.pathname === '/', await text('home.html')],
    [(url) => url.pathname.startsWith('/mangas/5/'), await text('title.html')],
    [(url) => url.pathname.startsWith('/chapters/'), await text('reader.html')],
  ];

  it('lists every project on one page', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.tcb, fetchImpl).popular({ page: 1 });
    assert.equal(requests[0].url, `${BASE}/projects`);
    assert.deepEqual(page.items.map((item) => item.title), ['Black Clover', 'Black Clover Gaiden: Quartet Knights', 'One Piece']);
    assert.deepEqual(page.items[2], { title: 'One Piece', url: `${BASE}/mangas/5/one-piece`, cover: page.items[2].cover });
    assert.match(page.items[2].cover, /^https:\/\/cdn\.onepiecechapters\.com\//);
    assert.equal(page.hasNextPage, false);
  });

  it('lists the projects of the home page’s latest chapters, matching the longest name (Gaiden is not Black Clover)', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const page = await loadSource(sources.tcb, fetchImpl).latest({ page: 1 });
    // Spy x Family isn't in the recorded projects page, so its chapter is skipped.
    assert.deepEqual(page.items.map((item) => item.title), ['One Piece', 'Black Clover', 'Black Clover Gaiden: Quartet Knights']);
    assert.deepEqual((await loadSource(sources.tcb, fetchImpl).latest({ page: 2 })).items, []);
  });

  it('searches by filtering the projects', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const page = await loadSource(sources.tcb, fetchImpl).search('black  CLOVER', 1, {});
    assert.deepEqual(page.items.map((item) => item.title), ['Black Clover', 'Black Clover Gaiden: Quartet Knights']);
  });

  it('reads a title page and its chapters, one per number, oldest first, with each chapter’s own title', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.tcb, fetchImpl).getDetail(`${BASE}/mangas/5/one-piece/`);
    assert.equal(detail.title, 'One Piece');
    assert.match(detail.description, /^As a child, Monkey D\. Luffy dreamed/);
    assert.match(detail.cover, /^https:\/\/cdn\.onepiecechapters\.com\//);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 1195, 1196]);
    assert.deepEqual(detail.chapters[3], {
      url: `${BASE}/chapters/8010/one-piece-chapter-1196`,
      title: 'Chapter 1196: The worthless love of someone with a death wish',
      number: 1196,
      date: null,
    });
  });

  it('reads the chapter’s images, not the site logo', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources.tcb, fetchImpl).getPages(`${BASE}/chapters/8010/one-piece-chapter-1196`);
    assert.deepEqual(pages.map((page) => page.url.split('/').pop()), ['op_1196_f_01.png', 'op_1196_f_01v2.png', 'op_1196_f_02.png']);
  });
});
