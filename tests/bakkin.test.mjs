import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'bakkin', path), 'utf8'));
let source;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-bakkin-${process.pid}`);
  await build(out);
  source = await readFile(join(out, 'sources', 'bakkin.bakkin.js'), 'utf8');
});

const B = 'https://bakkin.moe/reader/';

describe('Bakkin Reader X', () => {
  const routes = async () => [[(url) => url.pathname === '/reader/main.php', await data('main.json')]];

  it('lists the library from main.php, with reader links and covers', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const s = loadSource(source, fetchImpl);
    const page = await s.popular({ page: 1 });
    assert.equal(requests[0].url, `${B}main.php`);
    assert.deepEqual(page.items[0], { title: 'Yuru Yuri', url: `${B}#m=1_YRYR`, cover: `${B}caches/1_YRYR/v21/cover_thumb.png.jpg`, status: 'ongoing' });
    assert.equal(page.hasNextPage, false);
    assert.deepEqual((await s.search('YURU', 1, {})).items.map((item) => item.title), ['Yuru Yuri']);
    assert.deepEqual((await s.search('nothing like it', 1, {})).items, []);
  });

  it('keeps covers and bonus chapters, numbered just after the chapter before them', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(source, fetchImpl).getDetail(`${B}#m=1_YRYR`);
    assert.equal(detail.title, 'Yuru Yuri');
    assert.deepEqual(detail.authors, ['Namori']);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0.01, 1, 2, 2.01]);
    assert.equal(detail.chapters[0].title, 'Volume 1 - Cover');
    assert.equal(detail.chapters[1].url, `${B}#m=1_YRYR&v=v01&c=c001`);
    assert.match(detail.description, /^Latest: Chapter 173/);
  });

  it('numbers a collection whose chapter numbers repeat in reading order', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(source, fetchImpl).getDetail(`${B}#m=3_Misc`);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 3, 4]);
    assert.match(detail.chapters[2].title, /Anthology Comic v2 - /);
  });

  it('reads a chapter’s pages from its folder', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(source, fetchImpl).getPages(`${B}#m=1_YRYR&v=v01&c=c001`);
    assert.equal(pages.length, 2);
    assert.match(pages[0].url, /^https:\/\/bakkin\.moe\/reader\/caches\/1_YRYR\/v01\/c001\//);
    assert.equal(pages[0].headers.Referer, B);
  });
});
