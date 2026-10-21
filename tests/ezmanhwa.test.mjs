import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'ezmanhwa', path), 'utf8'));
let source;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-ezmanhwa-${process.pid}`);
  await build(out);
  source = await readFile(join(out, 'sources', 'ezmanhwa.qiscans.js'), 'utf8');
});

const API = 'https://api.qimanga.com/api/v1';
const B = 'https://qimanga.com';

describe('EZManhwa', () => {
  let slug;
  const routes = async () => {
    const series = await data('series.json');
    slug = series.slug;
    return [
      [(url) => url.pathname === '/api/v1/series' || url.pathname === '/api/v1/series/search', await data('series-list.json')],
      [(url) => url.pathname === `/api/v1/series/${slug}/chapters`, await data('chapters.json')],
      // The series has its own `status` field, which fakeFetch would read as the HTTP status.
      [(url) => url.pathname === `/api/v1/series/${slug}`, { status: 200, body: series }],
      [(url) => url.pathname.startsWith(`/api/v1/series/${slug}/chapters/`), await data('pages.json')],
    ];
  };

  it('lists from the API host with the site as Origin, leaving out novels', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(source, fetchImpl).popular({ page: 1 });
    assert.equal(requests[0].url, `${API}/series?page=1&perPage=20&sort=popular`);
    assert.equal(requests[0].headers.Origin, B);
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].url, `${B}/series/${slug}`);
    assert.equal(page.hasNextPage, true);
  });

  it('searches without filters (the search endpoint ignores them), and browses with them', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const s = loadSource(source, fetchImpl);
    await s.search(' eleceed ', 1, { filters: { status: 'ONGOING' } });
    await s.search('', 2, { filters: { sort: 'popular', status: 'COMPLETED', type: 'MANHWA', genre: 'action' } });
    assert.deepEqual(requests.map((request) => request.url), [
      `${API}/series/search?page=1&perPage=20&q=eleceed`,
      `${API}/series?page=2&perPage=20&sort=popular&status=COMPLETED&type=MANHWA&genre=action`,
    ]);
    const filters = await s.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'status', 'type', 'genre']);
  });

  it('reads a title and its free chapters, one per number, oldest first', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(source, fetchImpl).getDetail(`${B}/series/${slug}`);
    const chapters = (await data('chapters.json')).data;
    assert.equal(detail.title, 'Eleceed');
    assert.equal(detail.status, 'ongoing');
    assert.match(detail.description, /\n\nAlso known as: /);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [chapters[3].number, chapters[2].number, chapters[1].number]);
    assert.equal(detail.chapters[1].title, chapters[2].title);
    assert.equal(detail.chapters[2].title, `Chapter ${chapters[1].number}`);
    assert.equal(detail.chapters[2].url, `${B}/series/${slug}/${chapters[1].slug}`);
  });

  it('reads pages in order from the API’s chapter link, with their sizes', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(source, fetchImpl).getPages(`${B}/series/${slug}/chapter-423`);
    assert.equal(requests[0].url, `${API}/series/${slug}/chapters/chapter-423`);
    assert.deepEqual(pages.map((page) => page.url.split('/').pop()), ['00.webp', '01.webp', '02.webp']);
    assert.ok(pages[0].width > 0 && pages[0].height > 0);
    assert.equal(pages[0].headers.Referer, `${B}/`);
  });

  it('says so when a chapter needs buying', async () => {
    const { fetchImpl } = fakeFetch([[() => true, { images: null, requiresPurchase: true, totalImages: 12 }]]);
    await assert.rejects(loadSource(source, fetchImpl).getPages(`${B}/series/x/chapter-999`), /needs buying on Qi Scans/);
  });
});
