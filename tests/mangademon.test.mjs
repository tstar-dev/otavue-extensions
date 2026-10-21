import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'mangademon', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangademon-${process.pid}`);
  await build(out);
  sources.demon = await readFile(join(out, 'sources', 'mangademon.mangademon.js'), 'utf8');
});

const BASE = 'https://demonicscans.org';

describe('Manga Demon', () => {
  const routes = async () => [
    [(url) => url.pathname === '/advanced.php', await text('advanced.html')],
    [(url) => url.pathname === '/lastupdates.php', await text('latest.html')],
    [(url) => url.pathname === '/search.php', await text('search.html')],
    [(url) => url.pathname === '/manga/Solo-Leveling', await text('title.html')],
    [(url) => url.pathname === '/chaptered.php', await text('reader.html')],
  ];

  it('lists the most viewed titles, full names from the link (the heading is cut short), links kept as the site writes them', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.demon, fetchImpl).popular({ page: 2 });
    assert.equal(requests[0].url, `${BASE}/advanced.php?list=2&status=all&orderby=VIEWS%20DESC`);
    assert.deepEqual(page.items[0], {
      title: "Barbarian's Adventure in a Fantasy World",
      url: `${BASE}/manga/Barbarian%2527s-Adventure-in-a-Fantasy-World`,
      cover: "https://readermc.org/images/thumbnails/Barbarian%20's%20Adventure%20in%20a%20Fantasy%20World.webp",
    });
    assert.equal(page.hasNextPage, true);
  });

  it('lists latest updates without the paid early-access cards', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(sources.demon, fetchImpl).latest({ page: 1 });
    assert.equal(requests[0].url, `${BASE}/lastupdates.php?list=1`);
    assert.deepEqual(page.items.map((item) => item.title), ['I Became a Mage in a Medieval Fantasy World']);
  });

  it('searches by text through the quick search, and filters through the advanced page', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.demon, fetchImpl);
    const found = await source.search('solo', 1, {});
    assert.equal(requests[0].url, `${BASE}/search.php?manga=solo`);
    assert.deepEqual(found.items[0], { title: 'Solo Leveling', url: `${BASE}/manga/Solo-Leveling`, cover: 'https://readermc.org/images/thumbnails/Solo%20Leveling.webp' });
    assert.equal(found.hasNextPage, false);
    await source.search('', 3, { filters: { sort: 'NAME ASC', status: 'completed', genres: ['1', '5'] } });
    assert.equal(requests[1].url, `${BASE}/advanced.php?list=3&status=completed&orderby=NAME%20ASC&genre[]=1&genre[]=5`);
  });

  it('reads a title page and its chapters, numbered from the link, oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.demon, fetchImpl).getDetail(`${BASE}/manga/Solo-Leveling`);
    assert.equal(detail.title, 'Solo Leveling');
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.authors, ['Chugong', 'H-goon', 'KI Soryeong']);
    assert.deepEqual(detail.genres, ['Shounen', 'Fantasy', 'Drama', 'Adventure', 'Action']);
    assert.match(detail.description, /^10 years ago, after "the Gate"/);
    assert.match(detail.description, /\n\nAlso known as: I Alone Level Up, I Alone Level-Up, /);
    assert.equal(detail.cover, 'https://readermc.org/images/thumbnails/Solo%20Leveling.webp');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 1, 200, 200.5]);
    assert.deepEqual(detail.chapters[3], { url: `${BASE}/chaptered.php?manga=6&chapter=200.5`, title: 'Chapter 200.5', number: 200.5, date: '2024-07-13T00:00:00.000Z' });
  });

  it('reads the reader’s images, without the site’s own ad', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources.demon, fetchImpl).getPages(`${BASE}/chaptered.php?manga=6&chapter=200`);
    assert.deepEqual(pages.map((page) => page.url), [1, 2, 3].map((n) => `https://mangafifth.org/Solo%20Leveling/200/${n}.webp`));
  });
});
