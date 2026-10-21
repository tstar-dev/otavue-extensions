import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const text = (path) => readFile(join(import.meta.dirname, 'fixtures', path), 'utf8');
const sources = {};
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-madara-${process.pid}`);
  await build(out);
  for (const id of ['madara.mangasushi', 'madara.anisascans', 'madara.lilymanga', 'madara.topmanhuafan', 'madara.zinmanganet', 'madara.zazamanga']) {
    sources[id] = await readFile(join(out, 'sources', `${id}.js`), 'utf8');
  }
});

const path = (value) => (url) => url.pathname === value;
const AJAX = '/wp-admin/admin-ajax.php';
const TITLE = 'https://mangasushi.org/manga/game-of-familia-kazoku-senki/';
const CHAPTER = `${TITLE}chapter-86/`;
/** The form fields of a recorded POST. */
const fieldsOf = (request) => new URLSearchParams(request.body);

/** fakeFetch, also keeping each request's method and body. */
function recording(routes) {
  const { fetchImpl, requests } = fakeFetch(routes);
  return {
    requests,
    fetchImpl: async (url, opts = {}) => {
      const res = await fetchImpl(url, opts);
      Object.assign(requests.at(-1), { method: opts.method ?? 'GET', body: opts.body ?? null });
      return res;
    },
  };
}

describe('Madara', () => {
  it('lists the most viewed titles through madara_load_more, leaving out titles marked 18+', async () => {
    const { fetchImpl, requests } = recording([[path(AJAX), await text('madara/list.html')]]);
    const page = await loadSource(sources['madara.mangasushi'], fetchImpl).popular({ page: 2 });
    const fields = fieldsOf(requests[0]);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(fields.get('action'), 'madara_load_more');
    assert.equal(fields.get('page'), '1');
    assert.equal(fields.get('vars[meta_key]'), '_wp_manga_views');
    assert.equal(fields.get('vars[meta_query][0][key]'), '_wp_manga_chapter_type');
    assert.equal(fields.get('vars[meta_query][1][relation]'), 'OR');
    assert.equal(fields.get('vars[meta_query][1][1][compare]'), 'NOT LIKE');

    assert.equal(page.items.length, 3);
    assert.equal(page.hasNextPage, false);
    assert.deepEqual(page.items[0], {
      title: 'Lonely Attack on the Different World',
      url: 'https://mangasushi.org/manga/lonely-attack-on-the-different-world/',
      cover: 'https://mangasushi.org/wp-content/uploads/2022/01/LONELY-175x238.jpg',
      coverHeaders: { Referer: 'https://mangasushi.org/' },
    });
  });

  it('keeps titles marked 18+ on sites listed as 18+, and sorts latest by update', async () => {
    const list = (await text('madara/list.html')).replace('<div class="item-summary">', '<div class="item-summary"><span class="manga-title-badges custom adult">18+</span>');
    const { fetchImpl, requests } = recording([[path(AJAX), list]]);
    const page = await loadSource(sources['madara.anisascans'], fetchImpl).latest({ page: 1 });
    const fields = fieldsOf(requests[0]);
    assert.equal(fields.get('vars[meta_key]'), '_latest_update');
    assert.ok(![...fields.keys()].some((key) => fields.get(key) === 'manga_adult_content'));
    assert.equal(page.items.length, 3);
  });

  it('drops cards badged 18+ where the request can’t filter them', async () => {
    const list = (await text('madara/list.html')).replace('<div class="item-summary">', '<div class="item-summary"><span class="manga-title-badges custom adult">18+</span>');
    const { fetchImpl } = recording([[path(AJAX), list]]);
    const page = await loadSource(sources['madara.mangasushi'], fetchImpl).popular({ page: 1 });
    assert.equal(page.items.length, 2);
  });

  it('keys a title by its post id when its link is too long for Otavue', async () => {
    const long = 'a'.repeat(160);
    const list = (await text('madara/list.html')).replaceAll('lonely-attack-on-the-different-world', long);
    const { fetchImpl } = recording([[path(AJAX), list]]);
    const page = await loadSource(sources['madara.mangasushi'], fetchImpl).popular({ page: 1 });
    assert.equal(page.items[0].url, 'https://mangasushi.org/?p=1909');
  });

  it('searches with the query (straight quotes), status, genres and order', async () => {
    const { fetchImpl, requests } = recording([[path(AJAX), await text('madara/list.html')]]);
    await loadSource(sources['madara.mangasushi'], fetchImpl).search('It’s familia', 1, {
      filters: { sort: 'alphabet', status: ['end', 'on-hold'], genres: ['action', 'isekai'], genreMode: 'and' },
    });
    const fields = fieldsOf(requests[0]);
    assert.equal(fields.get('vars[s]'), "It's familia");
    assert.equal(fields.get('vars[orderby]'), 'post_title');
    assert.equal(fields.get('vars[meta_query][2][key]'), '_wp_manga_status');
    assert.equal(fields.get('vars[meta_query][2][value][1]'), 'on-hold');
    assert.equal(fields.get('vars[tax_query][0][terms][1]'), 'isekai');
    assert.equal(fields.get('vars[tax_query][0][operator]'), 'AND');
  });

  it('offers the site’s genres as a filter', async () => {
    const { fetchImpl, requests } = recording([[path('/manga/'), await text('madara/genres.html')]]);
    const filters = await loadSource(sources['madara.mangasushi'], fetchImpl).getFilters();
    assert.equal(requests[0].url, 'https://mangasushi.org/manga/');
    assert.deepEqual(filters.map((filter) => filter.key), ['sort', 'status', 'genres', 'genreMode']);
    const genres = filters.find((filter) => filter.key === 'genres').options;
    assert.ok(genres.length > 10);
    assert.deepEqual(genres[0], { value: 'action', label: 'Action' });
  });

  it('reads a title page, with chapters from the newer ajax/chapters endpoint', async () => {
    const { fetchImpl, requests } = recording([
      [path('/manga/game-of-familia-kazoku-senki/'), await text('madara/detail.html')],
      [path('/manga/game-of-familia-kazoku-senki/ajax/chapters/'), await text('madara/chapters.html')],
    ]);
    const detail = await loadSource(sources['madara.mangasushi'], fetchImpl).getDetail(TITLE);
    assert.equal(detail.title, 'Game of Familia: Kazoku Senki');
    assert.equal(detail.cover, 'https://mangasushi.org/wp-content/uploads/2022/01/game-obu-193x278.jpg');
    assert.equal(detail.status, 'ongoing');
    assert.deepEqual(detail.authors, ['Yamaguchi Mikoto', 'D.P']);
    assert.deepEqual(detail.genres, ['Action', 'Adventure', 'Drama', 'Fantasy', 'Horror', 'Isekai', 'Romance', 'Manga']);
    assert.match(detail.description, /^The protagonist along with his step-mother/);
    assert.match(detail.description, /“Dead Mell”/);
    assert.match(detail.description, /Also known as: Game of Familia –Family War Chronicles–/);

    assert.equal(requests[1].method, 'POST');
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [82, 83, 84, 85, 86]);
    assert.deepEqual(detail.chapters.at(-1), { url: CHAPTER, title: 'Chapter 86', number: 86, date: '2026-09-19T00:00:00.000Z' });
  });

  it('falls back to admin-ajax.php with the post id on older sites', async () => {
    const { fetchImpl, requests } = recording([
      [path('/manga/game-of-familia-kazoku-senki/'), await text('madara/detail.html')],
      [path('/manga/game-of-familia-kazoku-senki/ajax/chapters/'), { status: 404, body: '' }],
      [path(AJAX), await text('madara/chapters.html')],
    ]);
    const chapters = await loadSource(sources['madara.mangasushi'], fetchImpl).getChapters(TITLE);
    const fields = fieldsOf(requests[2]);
    assert.equal(fields.get('action'), 'manga_get_chapters');
    assert.equal(fields.get('manga'), '1868');
    assert.equal(chapters.length, 5);
  });

  it('leaves out locked, off-site and repeated chapters', async () => {
    const chapters = (await text('madara/chapters.html'))
      .replace('<li class="wp-manga-chapter ', '<li class="wp-manga-chapter premium ')
      .replace(`${TITLE}chapter-85/`, 'https://www.patreon.com/posts/85')
      .replace(`${TITLE}chapter-84/`, `${TITLE}chapter-83-raw/`)
      .replace('Chapter 84 ', 'Chapter 83 ');
    const { fetchImpl } = recording([
      [path('/manga/game-of-familia-kazoku-senki/'), await text('madara/detail.html')],
      [path('/manga/game-of-familia-kazoku-senki/ajax/chapters/'), chapters],
    ]);
    const list = await loadSource(sources['madara.mangasushi'], fetchImpl).getChapters(TITLE);
    assert.deepEqual(list.map((chapter) => chapter.number), [82, 83]);
    assert.equal(list[1].url, `${TITLE}chapter-83/`);
  });

  it('says why a title has nothing to read', async () => {
    const { fetchImpl } = recording([
      [path('/manga/game-of-familia-kazoku-senki/'), await text('madara/detail.html')],
      [path('/manga/game-of-familia-kazoku-senki/ajax/chapters/'), '<div class="listing-chapters_wrap"><ul></ul></div>'],
    ]);
    const detail = await loadSource(sources['madara.mangasushi'], fetchImpl).getDetail(TITLE);
    assert.deepEqual(detail.chapters, []);
    assert.match(detail.description, /^No chapters can be read on Mangasushi right now\./);
  });

  it('lists a chapter’s pages, trimmed, with the chapter as Referer', async () => {
    const { fetchImpl } = recording([[path('/manga/game-of-familia-kazoku-senki/chapter-86/'), await text('madara/chapter.html')]]);
    const pages = await loadSource(sources['madara.mangasushi'], fetchImpl).getPages(CHAPTER);
    assert.equal(pages.length, 3);
    assert.equal(pages[0].url, 'https://mangasushi.org/wp-content/uploads/WP-manga/data/manga_61d579c30b602/ad23c822a58acc1f0512f3055d619755/00.jpg');
    assert.equal(pages[0].headers.Referer, CHAPTER);
  });

  it('upgrades http images and can send the site as Referer', async () => {
    const chapter = (await text('madara/chapter.html')).replaceAll('https://mangasushi.org/wp-content', 'http://www.topmanhua.fan/wp-content');
    const { fetchImpl } = recording([[() => true, chapter]]);
    const url = 'https://www.topmanhua.fan/manhua/some-title/chapter-1/';
    const pages = await loadSource(sources['madara.topmanhuafan'], fetchImpl).getPages(url);
    assert.match(pages[0].url, /^https:\/\/www\.topmanhua\.fan\/wp-content\//);
    assert.equal(pages[0].headers.Referer, 'https://www.topmanhua.fan/');
  });

  it('decrypts pages hidden by the chapter protector', async () => {
    const images = ['https://mangasushi.org/a/0.jpg', 'https://mangasushi.org/a/1.jpg'];
    const nonce = 'a1b2c3d4e5';
    const salt = Buffer.from('0011223344556677', 'hex');
    // OpenSSL's EVP_BytesToKey with MD5, as CryptoJS does.
    let derived = Buffer.alloc(0);
    let block = Buffer.alloc(0);
    while (derived.length < 48) {
      block = createHash('md5').update(Buffer.concat([block, Buffer.from(nonce), salt])).digest();
      derived = Buffer.concat([derived, block]);
    }
    const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
    const ct = Buffer.concat([cipher.update(JSON.stringify(JSON.stringify(images))), cipher.final()]).toString('base64');
    const data = JSON.stringify({ ct, iv: derived.subarray(32, 48).toString('hex'), s: salt.toString('hex') }).replaceAll('/', '\\/');
    const script = `var wpmangaprotectornonce='${nonce}';\nvar chapter_data='${data}';`;
    const html = `<div class="reading-content"><script id="chapter-protector-data" src="data:text/javascript;base64,${Buffer.from(script).toString('base64')}"></script></div>`;
    const { fetchImpl } = recording([[() => true, html]]);
    const pages = await loadSource(sources['madara.mangasushi'], fetchImpl).getPages(CHAPTER);
    assert.deepEqual(pages.map((page) => page.url), images);
  });

  it('reads plain list pages on sites without madara_load_more', async () => {
    const { fetchImpl, requests } = recording([[path('/gl/page/2/'), await text('madara/archive.html')]]);
    const page = await loadSource(sources['madara.lilymanga'], fetchImpl).popular({ page: 2 });
    assert.equal(requests[0].url, 'https://lilymanga.net/gl/page/2/?m_orderby=views');
    assert.equal(page.items.length, 3);
    assert.equal(page.items[0].url, 'https://lilymanga.net/gl/my-food-seems-to-be-very-cute/');
    assert.equal(page.hasNextPage, true);
  });

  it('searches plain list sites through the WordPress search page', async () => {
    const { fetchImpl, requests } = recording([[path('/'), await text('madara/archive.html')]]);
    await loadSource(sources['madara.lilymanga'], fetchImpl).search('mermaid', 1, {});
    assert.equal(requests[0].url, 'https://lilymanga.net/?s=mermaid&post_type=wp-manga');
  });

  it('reads relative dates and each site’s date format', async () => {
    const chapters = (await text('madara/chapters.html'))
      .replace('<i>September 19, 2026</i>', '<a href="#" title="2 days ago">new</a>')
      .replace('<i>August 31, 2026</i>', '<i>08/31/2026</i>');
    const { fetchImpl } = recording([
      [path('/manga/game-of-familia-kazoku-senki/'), await text('madara/detail.html')],
      [path('/manga/game-of-familia-kazoku-senki/ajax/chapters/'), chapters],
    ]);
    const list = await loadSource(sources['madara.mangasushi'], fetchImpl).getChapters(TITLE);
    const twoDaysAgo = Date.now() - 2 * 864e5;
    assert.ok(Math.abs(Date.parse(list.at(-1).date) - twoDaysAgo) < 60_000);
    assert.equal(list.at(-2).date, '2026-08-31T00:00:00.000Z');
  });

  it('reads chapters from /api/comics/<slug>/chapters on sites set to "api", page by page, with their numbers', async () => {
    const title = '<html><head><link rel="canonical" href="https://www.zinmanga.net/manga/contract-marriage-rewritten"></head><body><div class="post-title"><h1>Contract Marriage: Rewritten</h1></div></body></html>';
    const row = (n, name) => ({ chapter_num: n, chapter_name: name, chapter_slug: `chapter-${n}`, updated_at: '2026-10-21T15:30:19.000000Z' });
    const { fetchImpl, requests } = recording([
      [path('/manga/contract-marriage-rewritten'), title],
      [(url) => url.pathname.endsWith('/chapters') && url.searchParams.get('page') === '1', { success: true, data: { chapters: [row(22, 'Chapter 22'), row(21.5, 'Side story')], last_page: 2 } }],
      [(url) => url.pathname.endsWith('/chapters') && url.searchParams.get('page') === '2', { success: true, data: { chapters: [row(1, 'Chapter 1')], last_page: 2 } }],
    ]);
    const chapters = await loadSource(sources['madara.zinmanganet'], fetchImpl).getChapters('https://www.zinmanga.net/manga/contract-marriage-rewritten');
    assert.equal(new URL(requests[1].url).pathname, '/api/comics/contract-marriage-rewritten/chapters');
    assert.equal(requests[1].headers.Accept, 'application/json');
    assert.deepEqual(chapters.map((chapter) => chapter.number), [1, 21.5, 22]);
    assert.deepEqual(chapters[2], { url: 'https://www.zinmanga.net/manga/contract-marriage-rewritten/chapter-22', title: 'Chapter 22', number: 22, date: '2026-10-21T15:30:19.000000Z' });
  });

  it('reads chapters listed as <div class="wp-manga-chapter"> where a site says so', async () => {
    const chapters = (await text('madara/chapters.html')).replaceAll('<li class="wp-manga-chapter', '<div class="wp-manga-chapter').replaceAll('</li>', '</div>')
      .replaceAll('https://mangasushi.org/', 'https://www.zazamanga.com/');
    const { fetchImpl } = recording([[() => true, `<html><body><div class="post-title"><h1>X</h1></div>${chapters}</body></html>`]]);
    const list = await loadSource(sources['madara.zazamanga'], fetchImpl).getChapters('https://www.zazamanga.com/manga/x');
    assert.deepEqual(list.map((chapter) => chapter.number), [82, 83, 84, 85, 86]);
  });

  it('won’t follow a redirect off the site', async () => {
    const { fetchImpl } = recording([[() => true, '<html>ad</html>']]);
    const offsite = async (url, opts) => ({ ...(await fetchImpl(url, opts)), url: 'https://ads.example.com/landing' });
    await assert.rejects(loadSource(sources['madara.mangasushi'], offsite).getPages(CHAPTER), /only on ads\.example\.com/);
  });
});
