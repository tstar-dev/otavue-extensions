// EZManhwa (a reader with a JSON API on its own host: Qi Scans, EZmanga).
// Ported from Keiyoushi's EZManhwa (lib-multisrc/ezmanhwa in github.com/keiyoushi/extensions-source, Apache-2.0):
// its series, search, chapter and page endpoints, filters, and how it leaves out chapters that need buying.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (apiUrl is required):
//   apiUrl   the API ("https://api.qimanga.com/api/v1")
//   genres   [[label, slug], …] for the genre filter
//
// @theme ezmanhwa
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl).replace(/\/+$/, '');
var PER_PAGE = 20;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var API_HEADERS = { 'User-Agent': AGENT, Accept: 'application/json, text/plain, */*', Origin: BASE, Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(API + path, { headers: API_HEADERS });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return res.json();
}

function query(params) {
  return Object.keys(params).filter(function (key) { return params[key] !== '' && params[key] !== undefined && params[key] !== null; })
    .map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function titleUrl(slug) {
  return BASE + '/series/' + slug;
}

function slugOf(url) {
  var match = /\/series\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]);
}

function statusOf(text) {
  var status = String(text || '').toUpperCase();
  if (status === 'ONGOING' || status === 'MASS_RELEASED') return 'ongoing';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'DROPPED') return 'cancelled';
  if (status === 'HIATUS') return 'hiatus';
  return null;
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: titleUrl(series.slug), cover: series.cover || null, status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['latest', 'Latest'], ['popular', 'Popular'], ['newest', 'Newest'], ['alphabetical', 'Alphabetical']];
var STATUSES = [['', 'All'], ['ONGOING', 'Ongoing'], ['COMPLETED', 'Completed'], ['HIATUS', 'Hiatus'], ['DROPPED', 'Dropped']];
var TYPES = [['', 'All'], ['MANGA', 'Manga'], ['MANHWA', 'Manhwa'], ['MANHUA', 'Manhua']];

/** `{ data, totalPages, current }`; novels share the lists and are left out. */
async function list(path, params) {
  var body = await api(path + '?' + query(params));
  var items = (body.data || []).filter(function (series) { return series.slug && String(series.type || '').toUpperCase() !== 'NOVEL'; }).map(toItem);
  return { items: items, hasNextPage: Number(body.current) < Number(body.totalPages) };
}

async function popular(options) {
  return list('/series', { page: (options && options.page) || 1, perPage: PER_PAGE, sort: 'popular' });
}

async function latest(options) {
  return list('/series', { page: (options && options.page) || 1, perPage: PER_PAGE, sort: 'latest' });
}

async function search(text, pageNumber, options) {
  var words = String(text || '').trim();
  // The search endpoint ignores filters, so they only apply when browsing.
  if (words) return list('/series/search', { page: pageNumber || 1, perPage: PER_PAGE, q: words });
  var filters = (options && options.filters) || {};
  return list('/series', { page: pageNumber || 1, perPage: PER_PAGE, sort: filters.sort || 'latest', status: filters.status, type: filters.type, genre: filters.genre });
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [
    { type: 'select', key: 'sort', name: 'Sort by (ignored when searching by text)', options: options(SORTS), default: 'latest' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
  ];
  if ((SITE.genres || []).length) {
    out.push({ type: 'select', key: 'genre', name: 'Genre', options: [{ value: '', label: 'All' }].concat(SITE.genres.map(function (pair) { return { value: pair[1], label: pair[0] }; })), default: '' });
  }
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

/** "Chapter 12 - Title", without repeating a title that already says "Chapter 12". */
function chapterTitle(chapter) {
  var number = chapter.number === null || chapter.number === undefined ? '' : String(chapter.number);
  var title = String(chapter.title || '').trim();
  if (!number) return title || 'Chapter';
  if (!title || title === number) return 'Chapter ' + number;
  if (/^(chapter|ch\.?|episode|ep\.?)\s/i.test(title) && title.indexOf(number) >= 0) return title;
  return 'Chapter ' + number + (/^[-:]/.test(title) ? ' ' : ' - ') + title;
}

/** Free chapters (all pages of 100), one per number, oldest first. */
async function chaptersOf(slug) {
  var rows = [];
  for (var pageNumber = 1; pageNumber <= 30; pageNumber++) {
    var body = await api('/series/' + encodeURIComponent(slug) + '/chapters?' + query({ page: pageNumber, perPage: 100, sort: 'desc' }));
    rows = rows.concat(body.data || []);
    if (!(Number(body.current || 1) < Number(body.totalPages || 1))) break;
  }
  var seen = {};
  var out = [];
  rows.forEach(function (chapter) {
    if (chapter.requiresPurchase || !chapter.slug) return;
    var number = Number(chapter.number);
    if (chapter.number === null || !isFinite(number) || seen[number]) return;
    seen[number] = true;
    out.push({ url: titleUrl(slug) + '/' + chapter.slug, title: chapterTitle(chapter), number: number, date: chapter.createdAt || null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var slug = slugOf(url);
  var series = await api('/series/' + encodeURIComponent(slug));
  var chapters = await chaptersOf(slug);
  var description = textOf(parseHtml(String(series.description || '').replace(/\r?\n/g, '<br>')));
  var alt = String(series.alternativeTitles || '').trim();
  if (alt) description = (description ? description + '\n\n' : '') + 'Also known as: ' + alt;
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' without an account right now.' + (description ? '\n\n' + description : '');
  var people = [series.author, series.artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(series.title || '').trim(),
    cover: series.cover || null,
    description: description,
    status: statusOf(series.status),
    genres: (series.genres || []).map(function (genre) { return genre.name; }).filter(Boolean),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(slugOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** The site's chapter link is /series/<series>/<chapter>; the API's is /series/<series>/chapters/<chapter>. */
async function getPages(url) {
  var match = /\/series\/([^\/?#]+)\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var body = await api('/series/' + match[1] + '/chapters/' + match[2]);
  var images = (body.images || []).filter(function (image) { return image && image.url; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  if (images.length === 0) {
    if (body.requiresPurchase) throw new Error('This chapter needs buying on ' + SITE.name + '.');
    throw new Error('This chapter has no pages on ' + SITE.name + '.');
  }
  return images.map(function (image) {
    var page = { url: image.url, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
    if (image.width > 0 && image.height > 0) { page.width = image.width; page.height = image.height; }
    return page;
  });
}
