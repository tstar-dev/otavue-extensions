import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-mangathemesia-${process.pid}`);
  await build(out);
  for (const id of ['mangathemesia.asterscans', 'mangathemesia.thunderscans', 'mangathemesia.violetscans']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const TITLE = 'https://asterscans.com/manga/obsession/';
const CHAPTER = 'https://asterscans.com/obsession-chapter-13/';

describe('MangaThemesia', () => {
  it('lists popular titles from the theme’s list page, with covers', async () => {
    const list = (await text('mangathemesia/list.html')).replace('<div class="hpage">', '<div class="hpage"><a class="r" href="?page=2">Next</a>');
    const { fetchImpl, requests } = fakeFetch([[path('/manga/'), list]]);
    const page = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).popular({ page: 2 });
    assert.equal(requests[0].url, 'https://asterscans.com/manga/?page=2&order=popular');
    assert.equal(page.items.length, 3);
    assert.equal(page.hasNextPage, true);
    assert.deepEqual(page.items[0], {
      title: 'My husband hid the child',
      url: 'https://asterscans.com/manga/my-husband-hid-the-child/',
      cover: 'https://i2.wp.com/asterscans.com/wp-content/uploads/2026/09/ChatGPT_Image_Sep_4_2026_05_18_03_PM-228x300.jpg',
      coverHeaders: { Referer: 'https://asterscans.com/' },
    });
  });

  it('lists latest updates, and knows when there’s no next page', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/manga/'), await text('mangathemesia/list.html')]]);
    const page = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).latest({ page: 1 });
    assert.equal(new URL(requests[0].url).searchParams.get('order'), 'update');
    assert.equal(page.hasNextPage, false);
  });

  it('leaves out novels', async () => {
    const list = (await text('mangathemesia/list.html')).replace('<div class="limit">', '<div class="limit"><span class="novelabel">Novel</span>');
    const { fetchImpl } = fakeFetch([[path('/manga/'), list]]);
    const page = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).popular({ page: 1 });
    assert.equal(page.items.length, 2);
  });

  it('searches with the title, filters and genres', async () => {
    const { fetchImpl, requests } = fakeFetch([[path('/comics/'), await text('mangathemesia/list.html')]]);
    await loadSource(sources['mangathemesia.violetscans'], fetchImpl).search('It’s obsession', 1, {
      filters: { order: 'title', status: 'completed', type: 'Manhwa', genres: ['campus', 'childcare'] },
    });
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('title'), "It's obsession");
    assert.equal(params.get('order'), 'title');
    assert.equal(params.get('status'), 'completed');
    assert.equal(params.get('type'), 'Manhwa');
    assert.deepEqual(params.getAll('genre[]'), ['campus', 'childcare']);
  });

  it('searches again without quotes when the site stored curly ones', async () => {
    const empty = '<html><body><div class="listupd"></div></body></html>';
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.searchParams.get('title') === "Valentina's Paradise", empty],
      [path('/comics/'), await text('mangathemesia/list.html')],
    ]);
    const page = await loadSource(sources['mangathemesia.violetscans'], fetchImpl).search('Valentina’s Paradise', 1, {});
    assert.equal(new URL(requests[1].url).searchParams.get('title'), 'Valentina s Paradise');
    assert.equal(page.items.length, 3);
  });

  it('offers the site’s genres as a filter', async () => {
    const { fetchImpl } = fakeFetch([[path('/manga/'), await text('mangathemesia/list.html')]]);
    const filters = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['order', 'status', 'type', 'genres']);
    assert.deepEqual(filters[3].options[1], { value: 'capable-woman', label: 'Capable woman' });
  });

  it('reads a title page and its chapters, numbered from data-num', async () => {
    const { fetchImpl } = fakeFetch([[path('/manga/obsession/'), await text('mangathemesia/detail.html')]]);
    const detail = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).getDetail(TITLE);
    assert.equal(detail.title, 'Obsession');
    assert.equal(detail.cover, 'https://i1.wp.com/asterscans.com/wp-content/uploads/2026/08/pn.png');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Hamster']);
    assert.deepEqual(detail.genres, ['Drama', 'Modern', 'Obsessive woman', 'Possessiveness', 'Romance', 'School life', 'Manhwa']);
    assert.match(detail.description, /^Childhood friends Yuhan and Suah/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [11, 12, 13, 14]);
    assert.deepEqual(detail.chapters[2], { url: CHAPTER, title: 'Chapter 13', number: 13, date: '2026-10-09T00:00:00.000Z' });
  });

  it('leaves out locked and off-site chapters', async () => {
    const detail = (await text('mangathemesia/detail.html'))
      .replaceAll('<a href="https://asterscans.com/obsession-chapter-14/"', '<a data-bs-target="#lockedChapterModal" href="https://asterscans.com/obsession-chapter-14/"')
      .replace('href="https://asterscans.com/obsession-chapter-12/"', 'href="https://ko-fi.com/asterscans"');
    const { fetchImpl } = fakeFetch([[path('/manga/obsession/'), detail]]);
    const chapters = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).getChapters(TITLE);
    assert.deepEqual(chapters.map((chapter) => chapter.number), [11, 13]);
  });

  it('lists a chapter’s pages from the reader area', async () => {
    const { fetchImpl } = fakeFetch([[path('/obsession-chapter-13/'), await text('mangathemesia/chapter.html')]]);
    const pages = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).getPages(CHAPTER);
    assert.equal(pages.length, 3);
    assert.equal(pages[0].url, 'https://asterscans.com/wp-content/uploads/manga/a5a4337ca7189f8706c59647f0ee10a9/0005_96245b51.jpg');
    assert.equal(pages[0].headers.Referer, 'https://asterscans.com/');
  });

  it('falls back to the ts_reader script when the reader area is empty', async () => {
    const images = ['https:\\/\\/asterscans.com\\/a\\/1.jpg', 'https:\\/\\/asterscans.com\\/a\\/2.jpg'];
    const script = `ts_reader.run({"prevUrl":"","sources":[{"source":"Server 1","images":[${images.map((i) => `"${i}"`).join(',')}]}]});`;
    const html = `<div id="readerarea"></div><script src="data:text/javascript;base64,${Buffer.from(script).toString('base64')}"></script>`;
    const { fetchImpl } = fakeFetch([[() => true, html]]);
    const pages = await loadSource(sources['mangathemesia.asterscans'], fetchImpl).getPages(CHAPTER);
    assert.deepEqual(pages.map((page) => page.url), ['https://asterscans.com/a/1.jpg', 'https://asterscans.com/a/2.jpg']);
  });

  it('keeps changing numbers out of title links, and finds the current link when the old one is gone', async () => {
    const list = (await text('mangathemesia/list.html')).replaceAll('https://asterscans.com/manga/', 'https://en-thunderscans.com/comics/7395-');
    const { fetchImpl, requests } = fakeFetch([
      [path('/comics/obsession/'), { status: 404, body: '' }],
      [path('/comics/list-mode/'), '<div id="content"><div class="soralist"><ul><li><a class="series" href="https://en-thunderscans.com/comics/8812-obsession/">Obsession</a></li></ul></div></div>'],
      [path('/comics/8812-obsession/'), await text('mangathemesia/detail.html')],
      [path('/comics/'), list],
    ]);
    const source = loadSource(sources['mangathemesia.thunderscans'], fetchImpl);
    const page = await source.popular({ page: 1 });
    assert.equal(page.items[1].url, 'https://en-thunderscans.com/comics/obsession/');
    const detail = await source.getDetail(page.items[1].url);
    assert.equal(detail.title, 'Obsession');
    assert.deepEqual(requests.slice(1).map((request) => new URL(request.url).pathname), ['/comics/obsession/', '/comics/list-mode/', '/comics/8812-obsession/']);
  });
});
