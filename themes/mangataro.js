// MangaTaro (a WordPress reader with its own JSON API: MangaTaro, Rolia Scan).
// Ported from Keiyoushi's MangaTaro (lib-multisrc/mangataro in github.com/keiyoushi/extensions-source, Apache-2.0):
// its list (/wp-json/manga/v1/load), search (/auth/search), WordPress details, the signed chapter list and pages.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   mergePages   API pages read for one page of Latest and filtered lists (Rolia Scan: 5; its lists mix in
//                chapter entries without a link, which are left out)
//
// The chapter list needs a token: the first 16 hex digits of md5("<unix seconds>mng_ch_<yyyyMMddHH UTC>"). It's
// only accepted within about a minute of the server's clock, so a 403 is retried once on the server's Date header.
//
// @theme mangataro
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var MERGE = Math.max(1, SITE.mergePages || 1);
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var MAX_URL_BYTES = 150;

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function request(path, options) {
  options = options || {};
  var headers = { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' };
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  var res = await fetch(BASE + path, { method: options.json !== undefined ? 'POST' : 'GET', headers: headers, body: options.json !== undefined ? JSON.stringify(options.json) : undefined });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok && (options.allow || []).indexOf(res.status) < 0) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return res;
}

async function api(path, options) {
  return (await request(path, options)).json();
}

/** The HTML entities WordPress leaves in titles ("Rock &amp; Roll"). */
function unescapeHtml(text) {
  return textOf(parseHtml(String(text || '')));
}

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/* ── md5 (the chapter list's token) ───────────────────────────────────── */

function md5(text) {
  var bytes = unescape(encodeURIComponent(text));
  var words = [];
  for (var i = 0; i < bytes.length; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[(((bytes.length + 8) >> 6) + 1) * 16 - 2] = bytes.length * 8;
  var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  var K = [];
  for (var k = 0; k < 64; k++) K[k] = Math.floor(Math.abs(Math.sin(k + 1)) * 4294967296) | 0;
  var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (var block = 0; block < words.length; block += 16) {
    var a = a0, b = b0, c = c0, d = d0;
    for (var j = 0; j < 64; j++) {
      var f, g, round = j >> 4;
      if (round === 0) { f = (b & c) | (~b & d); g = j; }
      else if (round === 1) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (round === 2) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      var sum = (a + f + K[j] + (words[block + g] | 0)) | 0;
      var shift = S[round * 4 + (j % 4)];
      a = d; d = c; c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map(function (n) {
    var hex = '';
    for (var byte = 0; byte < 4; byte++) hex += ('0' + ((n >>> (byte * 8)) & 255).toString(16)).slice(-2);
    return hex;
  }).join('');
}

/* ── titles ───────────────────────────────────────────────────────────── */

/** "<site>/manga/<slug>#<id>"; the id is what the API wants, the slug keeps it a real link. */
function titleUrl(slug, id) {
  var url = BASE + '/manga/' + slug + '#' + id;
  return byteLength(url) <= MAX_URL_BYTES ? url : BASE + '/manga/#' + id;
}

function slugOfLink(link) {
  var match = /\/(?:manga|read)\/([^\/?#]+)/.exec(String(link || ''));
  return match ? match[1] : '';
}

function idOf(url) {
  var match = /#(\d+)$/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' title link. Find the title again to open it.');
  return match[1];
}

function statusOf(text) {
  var value = String(text || '').toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  return null;
}

function isNovel(type) {
  return String(type || '').toLowerCase() === 'novel';
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['popular', 'Popular'], ['post', 'Latest updates'], ['release', 'Release date'], ['title', 'Title A-Z']];
var TYPES = [['', 'All'], ['Manga', 'Manga'], ['Manhwa', 'Manhwa'], ['Manhua', 'Manhua']];
var STATUSES = [['', 'All'], ['Completed', 'Completed'], ['Ongoing', 'Ongoing']];

/** One API page of /wp-json/manga/v1/load: 24 rows, some of them novels or chapter entries without a link. */
async function loadPage(pageNumber, options) {
  // The API wants its lists as JSON strings ("[\"Manhwa\"]").
  var rows = await api('/wp-json/manga/v1/load', { json: {
    page: pageNumber,
    search: options.query || '',
    years: JSON.stringify(options.year ? [Number(options.year)] : []),
    genres: '[]',
    types: JSON.stringify(options.type ? [options.type] : []),
    statuses: JSON.stringify(options.status ? [options.status] : []),
    sort: (options.sort || 'popular') + '_' + (options.ascending ? 'asc' : 'desc'),
    genreMatchMode: 'any',
  } });
  return Array.isArray(rows) ? rows : [];
}

async function list(pageNumber, options, merge) {
  var seen = {};
  var items = [];
  var full = false;
  for (var n = 0; n < merge; n++) {
    var rows = await loadPage((pageNumber - 1) * merge + 1 + n, options);
    rows.forEach(function (row) {
      var slug = slugOfLink(row.url);
      if (!slug || isNovel(row.type) || seen[row.id]) return;
      seen[row.id] = true;
      items.push({ title: unescapeHtml(row.title), url: titleUrl(slug, row.id), cover: row.cover || null, status: statusOf(row.status) });
    });
    full = rows.length === 24;
    if (!full) break;
  }
  return { items: items, hasNextPage: full };
}

async function popular(options) {
  return list((options && options.page) || 1, { sort: 'popular' }, 1);
}

async function latest(options) {
  return list((options && options.page) || 1, { sort: 'post' }, MERGE);
}

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  if (query) {
    // The site's own search box: better matches than the list's search, up to 25 titles.
    if ((pageNumber || 1) > 1) return { items: [], hasNextPage: false };
    var body = await api('/auth/search', { json: { query: query, limit: 25 } });
    var items = (body.results || []).filter(function (row) { return !isNovel(row.type) && row.slug; }).map(function (row) {
      return { title: unescapeHtml(row.title), url: titleUrl(row.slug, row.id), cover: row.thumbnail || null, status: statusOf(row.status) };
    });
    return { items: items, hasNextPage: false };
  }
  var filters = (options && options.filters) || {};
  return list(pageNumber || 1, { sort: filters.sort || 'popular', ascending: filters.ascending, type: filters.type, status: filters.status, year: filters.year }, MERGE);
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  return [
    { type: 'select', key: 'sort', name: 'Sort by (ignored when searching by text)', options: options(SORTS), default: 'popular' },
    { type: 'toggle', key: 'ascending', name: 'Ascending', default: false },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'text', key: 'year', name: 'Year', placeholder: 'e.g. 2024', default: '' },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

function termsOf(post, taxonomy) {
  var groups = (post._embedded && post._embedded['wp:term']) || [];
  for (var i = 0; i < groups.length; i++) {
    if (groups[i] && groups[i][0] && groups[i][0].taxonomy === taxonomy) return groups[i].map(function (term) { return unescapeHtml(term.name); }).filter(Boolean);
  }
  return [];
}

function descriptionOf(post) {
  var doc = parseHtml(String((post.content && post.content.rendered) || ''));
  return all(doc, 'p').map(textOf).filter(Boolean).join('\n\n') || textOf(doc);
}

var serverOffset = 0;

function chapterPath(id, offset) {
  var now = new Date(Date.now() + serverOffset);
  var seconds = Math.floor(now.getTime() / 1000);
  var hour = now.toISOString().replace(/[-T:]/g, '').slice(0, 10);
  var token = md5(seconds + 'mng_ch_' + hour).slice(0, 16);
  return '/auth/manga-chapters?manga_id=' + id + '&offset=' + offset + '&limit=500&order=DESC&_t=' + token + '&_ts=' + seconds;
}

function dateHeader(res) {
  var headers = res.headers || {};
  var value = typeof headers.get === 'function' ? headers.get('date') : headers.date || headers.Date;
  var time = Date.parse(value || '');
  return isNaN(time) ? null : time;
}

async function chapterPage(id, offset) {
  var res = await request(chapterPath(id, offset), { allow: [403] });
  if (res.status === 403) {
    // A token from a clock that's off; use the server's time.
    var server = dateHeader(res);
    if (server === null) throw new Error(SITE.name + ' answered 403.');
    serverOffset = server - Date.now();
    res = await request(chapterPath(id, offset));
  }
  return res.json();
}

var PLACEHOLDERS = ['', 'N/A', '—', '-'];

/** Chapters in the site's language, one per number, oldest first. */
async function chaptersOf(id) {
  var rows = [];
  for (var round = 0; round < 20; round++) {
    var body = await chapterPage(id, rows.length);
    var batch = body.chapters || [];
    rows = rows.concat(batch);
    if (!body.has_more || batch.length === 0) break;
  }
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    if (String(row.language || '').toLowerCase() !== String(SITE.lang).toLowerCase() || !row.url) return;
    var number = Number(row.chapter);
    if (!isFinite(number) || seen[number]) return;
    seen[number] = true;
    var name = unescapeHtml(row.title);
    out.push({
      url: String(row.url).replace(/\/+$/, '').replace(/^http:\/\//, 'https://'),
      title: 'Chapter ' + row.chapter + (PLACEHOLDERS.indexOf(name) < 0 ? ': ' + name : ''),
      number: number,
      date: dateOf(row.date),
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var id = idOf(url);
  var post = await api('/wp-json/wp/v2/manga/' + id + '?_embed');
  var chapters = await chaptersOf(id);
  var description = descriptionOf(post);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var media = (post._embedded && post._embedded['wp:featuredmedia']) || [];
  return {
    title: unescapeHtml(post.title && post.title.rendered),
    cover: (media[0] && media[0].source_url) || null,
    description: description,
    genres: termsOf(post, 'post_tag'),
    authors: termsOf(post, 'manga_author'),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(idOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** ".../read/<slug>/ch12-705184" → 705184. */
async function getPages(url) {
  var match = /-(\d+)\/?$/.exec(String(url).replace(/[?#].*$/, ''));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var body = await api('/auth/chapter-content?chapter_id=' + match[1]);
  var images = (body.images || []).filter(Boolean);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: String(image).replace(/^http:\/\//, 'https://'), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
