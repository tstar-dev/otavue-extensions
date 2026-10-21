import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

// The .rsc fixtures hold real data from the sites in a cut-down RSC frame: the rows a source reads, with the two
// quirks found live (a text row glued to the next row, and a chapter list outlined to its own row as "$a2").
const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'vinetheme', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-vinetheme-${process.pid}`);
  await build(out);
  for (const id of ['vinetheme.drakescans', 'vinetheme.keroscans']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const SLUG = 'i-the-demon-lord-am-being-targeted-by-my-female-disciples';
const TITLE = `https://drakecomic.net/series/comic/${SLUG}`;

describe('VineTheme', () => {
  const routes = async () => [
    [path('/api/series'), JSON.parse(await text('series.json'))],
    [path('/series'), await text('filters.rsc')],
    [(url) => url.pathname.endsWith('/chapter/97'), await text('chapter-locked.rsc')],
    [(url) => url.pathname.includes('/chapter/'), await text('chapter.rsc')],
    [(url) => url.searchParams.get('page') === '2', await text('detail-2.rsc')],
    [path(`/series/comic/${SLUG}`), await text('detail.rsc')],
  ];

  it('lists from /api/series: Popular by bookmarks, Latest by update', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources['vinetheme.drakescans'], fetchImpl);
    const page = await source.popular({ page: 1 });
    assert.deepEqual(page.items[0], {
      title: 'Disastrous Necromancer',
      url: 'https://drakecomic.net/series/comic/disastrous-necromancer',
      cover: 'https://drakecomic.net/uploads/series/disastrous-necromancer/cover.webp',
      coverHeaders: { Referer: 'https://drakecomic.net/' },
      status: 'ongoing',
    });
    assert.equal(page.hasNextPage, true);
    await source.latest({ page: 2 });
    assert.deepEqual(requests.map((request) => Object.fromEntries(new URL(request.url).searchParams)), [
      { sort: 'popular', contentMode: 'comics', page: '1', limit: '24' },
      { sort: 'updated', contentMode: 'comics', page: '2', limit: '24' },
    ]);
  });

  it('searches with filters', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    await loadSource(sources['vinetheme.drakescans'], fetchImpl).search(' necromancer ', 1, { filters: { sort: 'rating', type: 'Manhua', origin: 'CHINESE', genres: ['action', 'adventure'] } });
    assert.deepEqual(Object.fromEntries(new URL(requests[0].url).searchParams), {
      q: 'necromancer', sort: 'rating', type: 'Manhua', origin: 'CHINESE', genre: 'action,adventure', contentMode: 'comics', page: '1', limit: '24',
    });
  });

  it('offers genres that have titles, from the /series page’s RSC data', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const filters = await loadSource(sources['vinetheme.drakescans'], fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'type', 'status', 'origin', 'genres']);
    assert.deepEqual(filters[4].options, [{ value: 'action', label: 'Action' }, { value: 'adventure', label: 'Adventure' }]);
    assert.equal(requests[0].headers.rsc, '1');
  });

  it('reads a title from RSC rows: a glued text row, an outlined chapter list, and a second page of chapters', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const detail = await loadSource(sources['vinetheme.drakescans'], fetchImpl).getDetail(TITLE);
    assert.equal(detail.title, 'I, The Demon Lord am being targeted by my female Disciples!');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres, ['Manhua', 'Action', 'Adventure']);
    assert.match(detail.description, /^Bai Feng transmigrated into an ancient chinese style dating game/);
    assert.match(detail.description, /— “quoted”, ✓\n\nAlso known as: /);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [0, 0.1, 49, 146]);
    assert.deepEqual(detail.chapters[3], { url: `${TITLE}/chapter/146`, title: 'Chapter 146', number: 146, date: '2026-10-07T15:42:58.367Z' });
    assert.deepEqual(requests.map((request) => request.url), [`${TITLE}?sort=desc`, `${TITLE}?sort=desc&page=2`]);
  });

  it('reads pages from imageUrl, even ones flagged encrypted, and leaves out redacted ones', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const pages = await loadSource(sources['vinetheme.drakescans'], fetchImpl).getPages(`${TITLE}/chapter/96`);
    assert.equal(pages.length, 3);
    assert.match(pages[0].url, /^https:\/\/media\.witchtoons\.net\/series\/.*\/0096\/p-.*\.webp$/);
    assert.equal(pages[0].width, 800);
    assert.equal(pages[0].height, 10000);
    assert.equal(pages[0].headers.Referer, 'https://drakecomic.net/');
  });

  it('says so when a chapter is locked', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    await assert.rejects(loadSource(sources['vinetheme.drakescans'], fetchImpl).getPages(`${TITLE}/chapter/97`), /locked on Drake Scans/);
  });

  it('cuts a slug too long for Otavue’s ids short, and finds the full one again by the API’s search', async () => {
    const id = 'cmv3hf8k70006lbs8vvv4l6an';
    const slug = 'i-was-reincarnated-as-the-older-brother-of-a-villainess-destined-to-die-so-i-want-to-change-the-future-by-raising-my-younger-sister';
    const series = { id, title: 'I was Reincarnated as the Older Brother of a Villainess', slug, urlSlug: slug, status: 'ONGOING' };
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.pathname === '/api/series' && url.searchParams.get('q') === 'i was reincarnated', { data: [series], meta: { hasMore: false } }],
      [path('/api/series'), { data: [series], meta: { hasMore: false } }],
      [path(`/series/comic/${slug}/chapter/16.2`), await text('chapter.rsc')],
    ]);
    const source = loadSource(sources['vinetheme.keroscans'], fetchImpl);
    const [item] = (await source.popular({ page: 1 })).items;
    assert.ok(Buffer.byteLength(item.url) <= 150);
    assert.match(item.url, new RegExp(`^https://keroscans\\.net/series/comic/i-was-reincarnated-[a-z-]+[a-z]#${id}$`));
    const chapterUrl = `${item.url.replace(/#.*/, '')}/chapter/16.2#${id}`;
    assert.equal((await source.getPages(chapterUrl)).length, 3);
    assert.equal(new URL(requests[1].url).searchParams.get('q'), 'i was reincarnated');
    assert.equal(new URL(requests[2].url).pathname, `/series/comic/${slug}/chapter/16.2`);
  });
});
