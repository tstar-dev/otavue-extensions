import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, fixture, loadSource } from './harness.mjs';

let code;
let spanish;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-test-${process.pid}`);
  await build(out);
  code = await readFile(join(out, 'sources', 'mangadex.en.js'), 'utf8');
  spanish = await readFile(join(out, 'sources', 'mangadex.es-la.js'), 'utf8');
});

const path = (pattern) => (url) => pattern.test(url.pathname);
const KUMO = 'eb2d1a45-d4e7-4e32-a171-b5b029c5b0cb';
const SOLO = '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0';

describe('MangaDex', () => {
  it('lists the most followed titles, English names first, with covers and paging', async () => {
    const { fetchImpl, requests } = fakeFetch([[path(/^\/manga$/), await fixture('mangadex/popular.json')]]);
    const page = await loadSource(code, fetchImpl).popular({ category: 'sub', dateRange: 7, page: 1 });
    assert.equal(page.items.length, 4);
    assert.deepEqual(page.items[0], {
      title: 'Na Honjaman Level-Up',
      englishTitle: 'Solo Leveling',
      url: `https://mangadex.org/title/${SOLO}`,
      cover: `https://uploads.mangadex.org/covers/${SOLO}/e90bdc47-c8b9-4df7-b2c0-17641b645ee1.jpg.512.jpg`,
      status: 'completed',
    });
    assert.equal(page.hasNextPage, true);
    const sent = new URL(requests[0].url);
    assert.deepEqual(sent.searchParams.getAll('contentRating[]'), ['safe', 'suggestive']);
    assert.equal(sent.searchParams.get('order[followedCount]'), 'desc');
    assert.deepEqual(sent.searchParams.getAll('availableTranslatedLanguage[]'), ['en']);
    assert.match(requests[0].headers['User-Agent'], /^Otavue /);
  });

  it('builds Latest from readable chapters, one card per title in upload order', async () => {
    const { fetchImpl, requests } = fakeFetch([
      [path(/^\/chapter$/), await fixture('mangadex/latest-chapters.json')],
      [path(/^\/manga$/), await fixture('mangadex/latest-manga.json')],
    ]);
    const page = await loadSource(code, fetchImpl).latest({ category: 'sub', page: 1 });
    // Six chapters from five titles; the repeated title shows once.
    assert.equal(page.items.length, 5);
    assert.equal(page.items[0].url, 'https://mangadex.org/title/719e707d-e2ad-4877-bc12-27f224d162b3');
    assert.equal(new URL(requests[0].url).searchParams.get('includeExternalUrl'), '0');
    assert.equal(new URL(requests[1].url).searchParams.getAll('ids[]').length, 5);
  });

  it('searches by title and sends filters as MangaDex parameters', async () => {
    const { fetchImpl, requests } = fakeFetch([[path(/^\/manga$/), await fixture('mangadex/popular.json')]]);
    const source = loadSource(code, fetchImpl);
    await source.search('kumo', 2, { filters: { order: 'rating', status: 'ongoing', demographic: 'any', tags: ['tag-1', 'tag-2'] } });
    const sent = new URL(requests[0].url).searchParams;
    assert.equal(sent.get('title'), 'kumo');
    assert.equal(sent.get('offset'), '24');
    assert.equal(sent.get('order[rating]'), 'desc');
    assert.deepEqual(sent.getAll('status[]'), ['ongoing']);
    assert.equal(sent.getAll('publicationDemographic[]').length, 0);
    assert.deepEqual(sent.getAll('includedTags[]'), ['tag-1', 'tag-2']);

    await source.search('', 1, {});
    assert.equal(new URL(requests[1].url).searchParams.get('order[followedCount]'), 'desc');
  });

  it('offers filters without the "content" tag group', async () => {
    const { fetchImpl } = fakeFetch([[path(/^\/manga\/tag$/), await fixture('mangadex/tags.json')]]);
    const filters = await loadSource(code, fetchImpl).getFilters();
    assert.deepEqual(filters.map((filter) => filter.key), ['order', 'status', 'demographic', 'tags']);
    const tags = await fixture('mangadex/tags.json');
    const contentTags = tags.data.filter((tag) => tag.attributes.group === 'content').map((tag) => tag.id);
    assert.ok(contentTags.length > 0);
    assert.ok(filters[3].options.length > 50);
    assert.ok(filters[3].options.every((option) => !contentTags.includes(option.value)));
  });

  it('describes a title with its readable chapters, one per number', async () => {
    const { fetchImpl } = fakeFetch([
      [path(/\/feed$/), await fixture('mangadex/feed.json')],
      [path(/^\/manga\/[0-9a-f-]+$/), await fixture('mangadex/detail.json')],
    ]);
    const detail = await loadSource(code, fetchImpl).getDetail(`https://mangadex.org/title/${KUMO}`);
    assert.equal(detail.title, 'Kumo desu ga, Nani ka?');
    assert.equal(detail.englishTitle, 'So I’m a Spider, So What?');
    assert.ok(detail.authors.length > 0);
    assert.ok(detail.genres.includes('Fantasy'));
    assert.ok(!detail.description.includes(']('), 'markdown links become plain text');
    // 15 uploads, chapter 78.1 twice.
    assert.equal(detail.chapters.length, 14);
    const numbers = detail.chapters.map((chapter) => chapter.number);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
    assert.equal(new Set(numbers).size, numbers.length);
    assert.match(detail.chapters[0].url, /^https:\/\/mangadex\.org\/chapter\/[0-9a-f-]{36}$/);
    assert.match(detail.chapters[0].title, /aumakua/);
  });

  it('says why a title has nothing to read when MangaDex only links to the publisher', async () => {
    const { fetchImpl } = fakeFetch([
      [path(/\/feed$/), await fixture('mangadex/feed-external.json')],
      [path(/^\/manga\/[0-9a-f-]+$/), await fixture('mangadex/detail.json')],
    ]);
    const detail = await loadSource(code, fetchImpl).getDetail(`https://mangadex.org/title/${SOLO}`);
    assert.deepEqual(detail.chapters, []);
    assert.match(detail.description, /^There are no chapters to read here: MangaDex only links to the official publisher/);
  });

  it('lists page images from the MangaDex@Home server', async () => {
    const atHome = await fixture('mangadex/at-home.json');
    const { fetchImpl } = fakeFetch([[path(/^\/at-home\/server\//), atHome]]);
    const pages = await loadSource(code, fetchImpl).getPages('https://mangadex.org/chapter/82d3cae0-27ea-48f0-aa51-d1cdffad2819');
    assert.equal(pages.length, atHome.chapter.data.length);
    assert.equal(pages[0], `${atHome.baseUrl}/data/${atHome.chapter.hash}/${atHome.chapter.data[0]}`);
  });

  it('waits out a rate limit, and explains other failures', async () => {
    let calls = 0;
    const { fetchImpl } = fakeFetch([[path(/^\/manga$/), async () => (++calls === 1 ? { status: 429, body: '' } : await fixture('mangadex/popular.json'))]]);
    assert.equal((await loadSource(code, fetchImpl).popular({ page: 1 })).items.length, 4);
    assert.equal(calls, 2);

    const down = fakeFetch([[() => true, { status: 503, body: '' }]]);
    await assert.rejects(loadSource(code, down.fetchImpl).popular({ page: 1 }), /maintenance/);
    await assert.rejects(loadSource(code, down.fetchImpl).getDetail('https://example.com/x'), /isn’t a MangaDex title link/);
  });

  it('asks for its own language on the other language sources, with that language’s titles first', async () => {
    const popularBody = await fixture('mangadex/popular.json');
    const { fetchImpl, requests } = fakeFetch([
      [path(/^\/manga$/), popularBody],
      [path(/^\/chapter$/), await fixture('mangadex/latest-chapters.json')],
      [path(/\/feed$/), await fixture('mangadex/feed.json')],
      [path(/^\/manga\/[0-9a-f-]+$/), await fixture('mangadex/detail.json')],
    ]);
    const source = loadSource(spanish, fetchImpl);
    const page = await source.popular({ page: 1 });
    await source.latest({ page: 1 });
    await source.getDetail(`https://mangadex.org/title/${KUMO}`);
    const sent = requests.map((request) => new URL(request.url));
    assert.deepEqual(sent[0].searchParams.getAll('availableTranslatedLanguage[]'), ['es-la']);
    assert.deepEqual(sent.find((url) => url.pathname === '/chapter').searchParams.getAll('translatedLanguage[]'), ['es-la']);
    assert.deepEqual(sent.find((url) => url.pathname.endsWith('/feed')).searchParams.getAll('translatedLanguage[]'), ['es-la']);
    // The title's Spanish (Latin America) name where MangaDex has one.
    const second = popularBody.data[1].attributes.altTitles.find((alt) => alt['es-la'])['es-la'];
    assert.equal(page.items[1].englishTitle, second);
  });
});
