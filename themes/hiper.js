// Hiper (Hiperdex's own reader: a React app over a tRPC API at /api/trpc).
// Ported from Keiyoushi's Hiper and Hiperdex (lib-multisrc/hiper and src/en/hiperdex in
// github.com/keiyoushi/extensions-source, Apache-2.0): the search, series, chapters and pages procedures, the
// API key header, getting the API's cookie from the home page, chapter names, and the sort, type, status, rating
// and genre filters.
//
// The build puts `var SITE = { id, name, lang, baseUrl, genres? };` above this file, one copy per site.
//
// The API answers 401 without its `__st` cookie, which the home page sets, and refuses chapter pages
// ("use the official app") without the `x-cfg-auth` header the site's own script sends. In Otavue the cookie lives
// in the app's cookie store once the home page is loaded; it's also kept here and sent back, for hosts that don't
// keep cookies. Covers and page images want the site as Referer. Novels are left out.
//
// @theme hiper
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var API_KEY = 'yceqt7qgu004';
var IMAGE_HEADERS = { Referer: BASE + '/' };
var PER_PAGE = 30;

/* ── requests ─────────────────────────────────────────────────────────── */

var cookie = '';

/** `name=value` pairs from a Set-Cookie header (several cookies may arrive joined by commas). */
function cookiesFrom(header) {
  var pairs = [];
  var pattern = /(?:^|,)\s*([A-Za-z0-9_.-]+=[^;,]*)/g;
  var match;
  while ((match = pattern.exec(String(header || '')))) pairs.push(match[1]);
  return pairs.join('; ');
}

/** Loads the home page, which sets the API's cookie. */
async function openSite() {
  var res = await fetch(BASE + '/', { headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
  var headers = res.headers || {};
  var set = cookiesFrom(headers['set-cookie'] || headers['Set-Cookie']);
  if (set) cookie = set;
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
}

/** One tRPC procedure's answer (`input` is its JSON; superjson leaves plain values as they are). */
async function api(procedure, input, retried) {
  var url = BASE + '/api/trpc/' + procedure + '?batch=1&input=' + encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  var headers = { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/', 'x-cfg-auth': API_KEY };
  if (cookie) headers.Cookie = cookie;
  var res = await fetch(url, { headers: headers });
  if (res.status === 401 && !retried) {
    await openSite();
    return api(procedure, input, true);
  }
  var text = await res.text();
  var body = null;
  try { body = JSON.parse(text); } catch (e) { /* not JSON: a block page */ }
  var answer = Array.isArray(body) ? body[0] : null;
  if (answer && answer.error) {
    var data = (answer.error.json && answer.error.json.data) || {};
    if (data.httpStatus === 404 || data.code === 'NOT_FOUND') throw new Error(SITE.name + ' no longer has this.');
    throw new Error(SITE.name + ' answered ' + (data.httpStatus || res.status) + '.');
  }
  if (!res.ok || !answer) {
    if (/cf-chl|Just a moment/i.test(text)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return answer.result && answer.result.data ? answer.result.data.json : null;
}

function https(url) {
  return url ? String(url).replace(/^http:\/\//, 'https://') : null;
}

/* ── titles ───────────────────────────────────────────────────────────── */

function titleUrl(slug) {
  return BASE + '/manga/' + slug;
}

function slugOf(url) {
  var match = /\/manga\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]);
}

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (status === 'ongoing') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'cancelled') return 'cancelled';
  return null;
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: titleUrl(series.slug), cover: https(series.coverUrl), coverHeaders: IMAGE_HEADERS, status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

/** A page of the site's search, which also serves the lists. Unset filters are left out (null is refused). */
async function searchPage(query, sort, filters, pageNumber) {
  var chosen = {};
  if (filters.genres && filters.genres.length) chosen.genres = filters.genres;
  ['type', 'status', 'contentRating'].forEach(function (key) { if (filters[key]) chosen[key] = filters[key]; });
  var offset = ((pageNumber || 1) - 1) * PER_PAGE;
  var body = await api('search.query', { q: query, sort: sort, filters: chosen, limit: PER_PAGE, offset: offset, maxRating: 'pornographic' });
  var hits = (body && body.hits) || [];
  return {
    items: hits.filter(function (series) { return series.slug && series.type !== 'novel'; }).map(toItem),
    hasNextPage: hits.length > 0 && offset + hits.length < (body.totalHits || 0),
  };
}

async function popular(options) {
  return searchPage('', 'popular', {}, (options && options.page) || 1);
}

async function latest(options) {
  return searchPage('', 'recent', {}, (options && options.page) || 1);
}

var SORTS = [['relevance', 'Relevance'], ['popular', 'Popular'], ['score', 'Score'], ['recent', 'Recently updated'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['alphabetical', 'A-Z']];
var RATINGS = [['', 'All'], ['safe', 'Safe'], ['suggestive', 'Suggestive'], ['erotica', 'Erotica'], ['pornographic', 'Pornographic']];
var TYPES = [['', 'All'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['webtoon', 'Webtoon'], ['one_shot', 'One shot']];
var STATUSES = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'On hiatus'], ['cancelled', 'Cancelled']];

function listOf(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  var query = String(text || '').trim();
  var sort = filters.sort || (query ? 'relevance' : 'popular');
  return searchPage(query, sort, { genres: listOf(filters.genres), type: filters.type, status: filters.status, contentRating: filters.rating }, pageNumber || 1);
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  return [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'popular' },
    { type: 'select', key: 'rating', name: 'Content rating', options: options(RATINGS), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'multi', key: 'genres', name: 'Genres', options: (SITE.genres || []).map(function (name) { return { value: name, label: name }; }), default: [] },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

/** "Chapter 12" or the chapter's own title, as Keiyoushi names them ("Side Story END" → "Chapter 200 Side Story END"). */
function chapterName(chapter) {
  var label = 'Chapter ' + chapter.number;
  var title = String(chapter.title || '').trim();
  if (!title) return label;
  return /\d/.test(title) ? title : label + ' ' + title;
}

/** Published chapters, one per number, oldest first; scheduled ones are left out. */
async function chaptersOf(series) {
  var rows = (await api('series.chapters', { seriesId: series.id })) || [];
  var now = Date.now();
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    var number = Number(row.number);
    if (!isFinite(number) || seen[number] || row.isDeleted) return;
    if ((row.status && row.status !== 'published') || (row.releaseAt && Date.parse(row.releaseAt) > now)) return;
    seen[number] = true;
    out.push({ url: titleUrl(series.slug) + '/' + number + '#' + row.id, title: chapterName(row), number: number, date: row.createdAt || null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

function alternativeTitles(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch (e) { return []; }
}

async function getDetail(url) {
  var series = await api('series.bySlugWithGenres', { slug: slugOf(url) });
  if (!series || !series.id) throw new Error(SITE.name + ' no longer has this.');
  var novel = series.type === 'novel';
  var chapters = novel ? [] : await chaptersOf(series);
  var description = String(series.synopsis || '').replace(/\r\n/g, '\n').trim();
  var also = alternativeTitles(series.alternativeTitles).filter(Boolean);
  if (also.length) description += (description ? '\n\n' : '') + 'Also known as: ' + also.join(', ');
  if (novel) description = 'This is a novel; Otavue only reads comics.' + (description ? '\n\n' + description : '');
  else if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var extra = [series.type, series.contentRating].filter(Boolean).map(function (word) {
    return String(word).charAt(0).toUpperCase() + String(word).slice(1).replace(/_/g, ' ');
  });
  var genres = (series.genres || []).concat(extra);
  var authors = (series.authors || []).concat(series.artists || []);
  return {
    title: String(series.title || '').trim(),
    cover: https(series.coverUrl),
    coverHeaders: IMAGE_HEADERS,
    description: description,
    status: statusOf(series.status),
    genres: genres,
    authors: authors.filter(function (name, i) { return name && authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  var series = await api('series.bySlugWithGenres', { slug: slugOf(url) });
  if (!series || !series.id) throw new Error(SITE.name + ' no longer has this.');
  return series.type === 'novel' ? [] : chaptersOf(series);
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var match = /\/manga\/([^\/?#]+)\/([\d.]+)(?:#(\d+))?/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var input = { seriesSlug: decodeURIComponent(match[1]), chapterNumber: Number(match[2]) };
  if (match[3]) input.chapterId = Number(match[3]);
  var rows = (await api('reader.chapterPages', input)) || [];
  var pages = rows.slice().sort(function (a, b) { return a.pageOrder - b.pageOrder; }).map(function (row) {
    var page = { url: https(row.avifUrl || row.webpUrl), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
    if (row.width && row.height) { page.width = row.width; page.height = row.height; }
    return page;
  }).filter(function (page) { return page.url; });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages;
}
