import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', 'flamecomics', path), 'utf8');
const json = async (path) => JSON.parse(await text(path));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-flamecomics-${process.pid}`);
  await build(out);
  sources.flame = await readFile(join(out, 'sources', 'flamecomics.flamecomics.js'), 'utf8');
});

const BASE = 'https://flamecomics.xyz';
const CDN = 'https://cdn.flamecomics.xyz/uploads/images/series';
const route = (path) => (url) => url.pathname === `/_next/data/NEWBUILD/${path}`;

describe('Flame Comics', () => {
  const routes = async () => [
    [(url) => url.pathname === '/', await text('home-new.html')],
    [route('browse.json'), await json('browse.json')],
    [route('latest.json'), await json('latest.json')],
    [route('series/165.json'), await json('series.json')],
    [(url) => url.pathname.startsWith('/_next/data/NEWBUILD/series/165/'), await json('chapter.json')],
  ];

  it('lists the catalogue by popularity rank, without novels or entries missing an id', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const source = loadSource(sources.flame, fetchImpl);
    const page = await source.popular({ page: 1 });
    assert.deepEqual(requests.map((request) => request.url), [`${BASE}/`, `${BASE}/_next/data/NEWBUILD/browse.json`]);
    assert.deepEqual(page.items.map((item) => item.title), ['Battle of the Six Realms', '30 Years Have Passed Since the Prologue', "A Regressor's Tale of Cultivation"]);
    assert.deepEqual(page.items[1], { title: '30 Years Have Passed Since the Prologue', url: `${BASE}/series/165`, cover: `${CDN}/165/thumbnail.webp?1786358505`, status: 'ongoing' });
    assert.equal(page.hasNextPage, false);
    const latest = await source.latest({ page: 1 });
    assert.equal(latest.items.length, 3);
    // The build id was read once and kept.
    assert.equal(requests.filter((request) => new URL(request.url).pathname === '/').length, 1);
  });

  it('reads the build id again when a deploy has replaced it (the old data route answers 404)', async () => {
    let deployed = false;
    const browse = await json('browse.json');
    const { fetchImpl, requests } = fakeFetch([
      [(url) => url.pathname === '/', async () => text(deployed ? 'home-new.html' : 'home-old.html')],
      [(url) => url.pathname === '/_next/data/OLDBUILD/browse.json', () => (deployed ? { status: 404, body: 'Not found' } : browse)],
      [(url) => url.pathname === '/_next/data/NEWBUILD/browse.json', browse],
    ]);
    const source = loadSource(sources.flame, fetchImpl);
    await source.popular({ page: 1 });
    deployed = true;
    const page = await source.popular({ page: 1 });
    assert.equal(page.items.length, 3);
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
      '/', '/_next/data/OLDBUILD/browse.json', '/_next/data/OLDBUILD/browse.json', '/', '/_next/data/NEWBUILD/browse.json',
    ]);
  });

  it('searches titles and alternative titles, and filters by type, status and tag', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources.flame, fetchImpl);
    assert.deepEqual((await source.search('30 YEARS', 1, {})).items.map((item) => item.title), ['30 Years Have Passed Since the Prologue']);
    assert.deepEqual((await source.search('since the prologue', 1, {})).items.map((item) => item.url), [`${BASE}/series/165`]);
    assert.deepEqual((await source.search('', 1, { filters: { type: 'manga' } })).items.map((item) => item.title), ['Battle of the Six Realms']);
    assert.deepEqual((await source.search('', 1, { filters: { tag: 'Academy', status: 'ongoing' } })).items.map((item) => item.url), [`${BASE}/series/165`]);
    const filters = await source.getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['type', 'status', 'tag']);
    assert.ok(filters[2].options.some((option) => option.value === 'Academy'));
  });

  it('reads a series and its released chapters: one per number, oldest first, notices and scheduled ones left out', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources.flame, fetchImpl).getDetail(`${BASE}/series/165`);
    assert.equal(detail.title, '30 Years Have Passed Since the Prologue');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.genres.slice(0, 3), ['Manhwa', 'Academy', 'Action']);
    assert.deepEqual(detail.authors, ['Markellaha', 'Studio GreenKirin']);
    assert.match(detail.description, /^I 'transmigrated' into a world I've never seen\.\n/);
    assert.match(detail.description, /\n\nAlso known as: 30 Years Since the Prologue$/);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [1, 2, 20, 21]);
    assert.deepEqual(detail.chapters[3], {
      url: `${BASE}/series/165/afb39d65a21a97e5`,
      title: "Chapter 21 - There's Always an Attack at the Academy Practical Lesson (3)",
      number: 21,
      date: '2026-10-20T10:43:07.000Z',
    });
  });

  it('reads a chapter’s images in key order from the CDN', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const pages = await loadSource(sources.flame, fetchImpl).getPages(`${BASE}/series/165/afb39d65a21a97e5`);
    assert.equal(requests[1].url, `${BASE}/_next/data/NEWBUILD/series/165/afb39d65a21a97e5.json?id=165&token=afb39d65a21a97e5`);
    assert.deepEqual(pages.map((page) => page.url), ['00', '01', '02'].map((n) => `${CDN}/165/afb39d65a21a97e5/30YRS-21-${n}.webp?1792492987`));
  });
});
