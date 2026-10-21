// MangaK (a Next.js reader over a JSON API at api.<site>; MangaK at mangak.io).
// Ported from Keiyoushi's MangaK (lib-multisrc/mangak in github.com/keiyoushi/extensions-source, Apache-2.0):
// /titles/search for lists, search and filters (sort, content rating, status, type, demographic, genres),
// /titles/<id>/chapters, the genre list from /genres, and cleaning search words.
//
// The build puts `var SITE = { id, name, lang, baseUrl, apiUrl? };` above this file, one copy per site.
//
// Keiyoushi reads details and pages from the site's Next.js pages; the API has both (/titles/<id> and
// /titles/<id>/chapters/<chapter id>, with page sizes), so this uses it. Title links carry the API id after `#`
// and chapter links `#<title id>/<chapter id>`; links without them are looked up on the site's page.
// The API's chapter `number` is only a position, so numbers come from chapter names; notices and other entries
// without one are left out. Covers and page images want the site as Referer.
//
// @theme mangak
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl || BASE.replace(/^https:\/\/(?:www\.)?/, 'https://api.')).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var IMAGE_HEADERS = { Referer: BASE + '/' };
var PER_PAGE = 24;

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url, accept) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: accept, Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(url)) throw new Error(SITE.name + ' no longer has this.');
  return res;
}

/** The API's `data`. */
async function api(path) {
  var body = await (await request(API + path, 'application/json')).json();
  if (!body || body.success === false || !body.data) throw new Error(SITE.name + ' no longer has this.');
  return body.data;
}

/** The `pageProps` of one of the site's pages. */
async function pageProps(url) {
  var html = await (await request(url, 'text/html')).text();
  var match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  var props = null;
  try { props = match && JSON.parse(match[1]).props.pageProps; } catch (e) { props = null; }
  if (!props) throw new Error(SITE.name + ' no longer has this.');
  return props;
}

function https(url) {
  return url ? String(url).replace(/^http:\/\//, 'https://') : null;
}

/* ── titles ───────────────────────────────────────────────────────────── */

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (status === 'ongoing') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'cancelled') return 'cancelled';
  return null;
}

function toItem(title) {
  return { title: String(title.name || '').trim(), url: BASE + title.url + '#' + title.id, cover: https(title.cover), coverHeaders: IMAGE_HEADERS, status: statusOf(title.status) };
}

/** The API id of a title link: after `#`, or from the site's page. */
async function titleIdOf(url) {
  var match = /^https?:\/\/[^\/]+(\/[^\/?#]+)\/?(?:\?[^#]*)?(?:#([A-Za-z0-9]+))?$/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  if (match[2]) return match[2];
  var manga = (await pageProps(BASE + match[1])).initialManga;
  if (!manga || !manga.id) throw new Error(SITE.name + ' no longer has this.');
  return manga.id;
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function searchPage(params, pageNumber) {
  var query = ['page=' + (pageNumber || 1), 'limit=' + PER_PAGE];
  for (var key in params) if (params[key]) query.push(key + '=' + encodeURIComponent(params[key]));
  var data = await api('/titles/search?' + query.join('&'));
  return {
    items: (data.items || []).filter(function (title) { return title.id && title.url; }).map(toItem),
    hasNextPage: Boolean(data.pagination && data.pagination.has_next),
  };
}

async function popular(options) {
  return searchPage({ sort: 'popular', window: 'week' }, (options && options.page) || 1);
}

async function latest(options) {
  return searchPage({ sort: 'latest' }, (options && options.page) || 1);
}

/** Letters, digits and spaces only, at most 50 characters, as Keiyoushi sends them. */
function searchWords(text) {
  return String(text || '').replace(/[^\p{L}\p{N} ]+/gu, '').trim().slice(0, 50);
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  var genres = Array.isArray(filters.genres) ? filters.genres : filters.genres ? [filters.genres] : [];
  return searchPage({
    q: searchWords(text),
    sort: filters.sort,
    content_rating: filters.rating,
    status: filters.status,
    type: filters.type,
    demographic: filters.demographic,
    genres: genres.join(','),
  }, pageNumber || 1);
}

var SORTS = [['', 'Best match'], ['popular', 'Most followed'], ['latest', 'Latest updated'], ['newest', 'Recently added'], ['rating', 'Highest rating'],
  ['views_today', 'Most viewed: today'], ['views_7days', 'Most viewed: 7 days'], ['views_30days', 'Most viewed: 30 days'], ['views', 'Most viewed: all time'],
  ['chapters', 'Most chapters'], ['alphabetical', 'A-Z']];
var RATINGS = [['', 'Any'], ['safe', 'Safe'], ['suggestive', 'Suggestive'], ['erotica', 'Erotica'], ['pornographic', 'Pornographic']];
var STATUSES = [['', 'Any'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['cancelled', 'Cancelled']];
var TYPES = [['', 'Any'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua']];
var DEMOGRAPHICS = [['', 'Any'], ['shounen,seinen', 'Boy (Shounen + Seinen)'], ['shoujo,josei', 'Girl (Shoujo + Josei)'], ['shounen', 'Shounen'],
  ['shoujo', 'Shoujo'], ['seinen', 'Seinen'], ['josei', 'Josei']];

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var genres = [];
  try { genres = ((await api('/genres')).items || []).map(function (genre) { return { value: genre.slug, label: genre.name }; }); } catch (e) { genres = []; }
  var filters = [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: '' },
    { type: 'select', key: 'rating', name: 'Content rating', options: options(RATINGS), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
    { type: 'select', key: 'demographic', name: 'Demographic', options: options(DEMOGRAPHICS), default: '' },
  ];
  if (genres.length) filters.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
  return filters;
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Every numbered chapter, one per number, oldest first. */
async function chaptersOf(titleId) {
  var rows = (await api('/titles/' + titleId + '/chapters?cv=' + Date.now())).chapters || [];
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    var name = clean(String(row.name || ''));
    var number = /(?:chapter|chap|ch|episode|ep)\.?\s*\d/i.test(name) ? numberOf(name, '') : null;
    if (number === null || !row.url || !row.id || seen[number]) return;
    seen[number] = true;
    out.push({ url: BASE + row.url + '#' + titleId + '/' + row.id, title: name, number: number, date: row.updated_at || null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

function names(list) {
  return (list || []).map(function (entry) { return clean(String((entry && entry.name) || '')); }).filter(Boolean);
}

async function getDetail(url) {
  var titleId = await titleIdOf(url);
  var title = (await api('/titles/' + titleId)).title;
  if (!title) throw new Error(SITE.name + ' no longer has this.');
  var chapters = await chaptersOf(titleId);
  var description = String(title.summary || '').trim();
  var also = names(title.alt_names);
  if (also.length) description += (description ? '\n\n' : '') + 'Also known as: ' + also.join(', ');
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = names(title.genres).concat(names(title.demographics), names(title.formats), names(title.themes));
  if (title.type && title.type.name) genres.push(title.type.name.charAt(0).toUpperCase() + title.type.name.slice(1));
  var authors = names(title.authors).concat(names(title.artists));
  return {
    title: String(title.name || '').trim(),
    cover: https(title.cover),
    coverHeaders: IMAGE_HEADERS,
    description: description,
    status: statusOf(title.status),
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await titleIdOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var ids = /#([A-Za-z0-9]+)\/([A-Za-z0-9]+)$/.exec(String(url));
  var chapter;
  if (ids) chapter = (await api('/titles/' + ids[1] + '/chapters/' + ids[2])).chapter;
  else chapter = (await pageProps(String(url).replace(/#.*$/, ''))).initialChapter;
  var rows = (chapter && (chapter.pages || (chapter.images || []).map(function (image) { return { url: image }; }))) || [];
  var pages = rows.filter(function (row) { return row && row.url; }).map(function (row) {
    var page = { url: https(row.url), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
    if (row.width && row.height) { page.width = row.width; page.height = row.height; }
    return page;
  });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages;
}
