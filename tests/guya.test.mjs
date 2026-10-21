import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'guya', path), 'utf8'));
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-guya-${process.pid}`);
  await build(out);
  for (const id of ['guya.guya', 'guya.dankefurslesen', 'guya.magicaltranslators', 'guya.magicaltranslators.es', 'guya.magicaltranslators.pl']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const KAGUYA = 'https://guya.cubari.moe/read/manga/Kaguya-Wants-To-Be-Confessed-To-Official-Doujin/';

describe('Guya', () => {
  const routes = async () => [
    [path('/api/get_all_series/'), await data('all-series.json')],
    [path('/api/series/Kaguya-Wants-To-Be-Confessed-To-Official-Doujin/'), await data('series.json')],
    [(url) => url.pathname.startsWith('/api/series/'), await data('series-html.json')],
  ];

  it('lists the whole catalogue in one page, in the site’s order', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const page = await loadSource(sources['guya.magicaltranslators'], fetchImpl).popular({ page: 1 });
    assert.deepEqual(page.items[0], {
      title: 'A Boy Who Loves Genderswap Got Genderswapped so He Acts out His Ideal Genderswap Girl',
      url: 'https://mahoushoujobu.com/read/manga/GB-Lover/',
      cover: 'https://mahoushoujobu.com/media/manga/GB-Lover/volume_covers/7/001.png',
      coverHeaders: { Referer: 'https://mahoushoujobu.com/' },
    });
    assert.equal(page.hasNextPage, false);
  });

  it('splits Magical Translators by language from the slug’s suffix', async () => {
    const urls = async (id) => (await loadSource(sources[id], fakeFetch(await routes()).fetchImpl).popular({ page: 1 })).items.map((item) => item.url.split('/')[5]);
    assert.deepEqual(await urls('guya.magicaltranslators'), ['GB-Lover', 'Boys-WUGOM']);
    assert.deepEqual(await urls('guya.magicaltranslators.es'), ['Bro-Girl-ES']);
    assert.deepEqual(await urls('guya.magicaltranslators.pl'), ['Magical-Trans-PL']);
  });

  it('sorts Latest by last update, and searches titles here', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources['guya.magicaltranslators'], fetchImpl);
    const all = await data('all-series.json');
    const newest = Object.entries(all).filter(([, series]) => !/-(ES|PL)$/.test(series.slug)).sort((a, b) => b[1].last_updated - a[1].last_updated)[0][0];
    assert.equal((await source.latest({ page: 1 })).items[0].title, newest);
    assert.deepEqual((await source.search('GENDERSWAP', 1, {})).items.map((item) => item.url.split('/')[5]), ['GB-Lover']);
  });

  it('reads a title, one chapter per number from the group the site prefers', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources['guya.guya'], fetchImpl).getDetail(KAGUYA);
    assert.equal(detail.title, 'Kaguya Wants To Be Confessed To Official Doujin');
    assert.deepEqual(detail.authors, ['Sakayama Shinta']);
    assert.match(detail.cover, /^https:\/\/guya\.cubari\.moe\/media\/manga\/Kaguya-.*\/volume_covers\//);
    assert.deepEqual(detail.chapters.map((chapter) => [chapter.number, chapter.url.split('#')[1]]), [[1, '3'], [15, '3'], [24.5, '2']]);
    assert.equal(detail.chapters[1].title, 'Chapter 15 - Miyuki Shirogane Wants to Nurture Kindergarteners');
    assert.equal(detail.chapters[1].date, '2019-07-16T21:11:06.000Z');
    assert.equal(detail.chapters[2].url, `${KAGUYA}24-5/1/#2`);
  });

  it('reads pages from the chapter’s group folder', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const source = loadSource(sources['guya.guya'], fetchImpl);
    const pages = await source.getPages(`${KAGUYA}15/1/#3`);
    assert.deepEqual(pages.map((page) => page.url), [
      'https://guya.cubari.moe/media/manga/Kaguya-Wants-To-Be-Confessed-To-Official-Doujin/chapters/0015_7lisrc5r/3/01.png',
      'https://guya.cubari.moe/media/manga/Kaguya-Wants-To-Be-Confessed-To-Official-Doujin/chapters/0015_7lisrc5r/3/02_w.png',
    ]);
    assert.equal(pages[0].headers.Referer, 'https://guya.cubari.moe/');
    // A link without a group, or with one that's gone, falls back to the preferred group; "24-5" is chapter 24.5.
    assert.match((await source.getPages(`${KAGUYA}15/1/`))[0].url, /\/0015_7lisrc5r\/3\//);
    assert.match((await source.getPages(`${KAGUYA}24-5/1/#9`))[0].url, /\/2\/[^/]+$/);
  });

  it('drops the author’s link blocks from an HTML description', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const detail = await loadSource(sources['guya.dankefurslesen'], fetchImpl).getDetail('https://danke.moe/read/manga/a-story-about-a-senpai-who-wants-to-reject-a-girl/');
    assert.match(detail.description, /^Support the artist!/);
    assert.doesNotMatch(detail.description, /Pixiv|<a|imgur/);
  });
});
