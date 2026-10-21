// HeanCMS (a reader with a JSON API at api.<site>; Lua Scans).
// Ported from Keiyoushi's HeanCms (lib-multisrc/heancms in github.com/keiyoushi/extensions-source, Apache-2.0):
// its query, series, chapter and page endpoints, and how it leaves out paid and scheduled chapters.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   apiUrl         the API ("https://api.<site>")      seriesPath  where titles live on the site ("series")
//   latestSort     the API's sort for Latest: "latest" (the default), or "updated_at" where "latest" doesn't sort by date
//
// @theme heancms
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl || BASE.replace('://', '://api.')).replace(/\/+$/, '');
var SERIES_PATH = SITE.seriesPath || 'series';
var PER_PAGE = 12;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
// The API's firewall turns away requests that don't come from the site's own pages.
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
  return Object.keys(params).map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function seriesUrl(slug) {
  return BASE + '/' + SERIES_PATH + '/' + slug;
}

function slugOf(url) {
  var match = new RegExp('/' + SERIES_PATH + '/([^/?#]+)').exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' title link.');
  return match[1];
}

function imageUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path.replace(/^http:/, 'https:') : API + '/' + String(path).replace(/^\/+/, '');
}

function statusOf(text) {
  var value = String(text || '').toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  if (value === 'hiatus') return 'hiatus';
  if (value === 'dropped') return 'cancelled';
  return null;
}

function toItem(series) {
  return { title: series.title, url: seriesUrl(series.series_slug), cover: imageUrl(series.thumbnail), status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['total_views', 'Views'], [SITE.latestSort || 'latest', 'Latest'], ['title', 'Title'], ['created_at', 'Added']];
var STATUSES = [['All', 'All'], ['Ongoing', 'Ongoing'], ['Hiatus', 'On hiatus'], ['Dropped', 'Dropped'], ['Completed', 'Completed']];

/** `/query`: 12 comics a page, with `meta.current_page` and `meta.last_page`. */
async function list(pageNumber, options) {
  var body = await api('/query?' + query({
    query_string: options.query || '',
    status: options.status || 'All',
    order: options.order || 'desc',
    orderBy: options.orderBy || 'total_views',
    series_type: 'Comic',
    page: pageNumber || 1,
    perPage: PER_PAGE,
    tags_ids: '[' + (options.tags || []).join(',') + ']',
    adult: 'true',
  }));
  var meta = body.meta || {};
  return { items: (body.data || []).map(toItem), hasNextPage: Number(meta.current_page) < Number(meta.last_page) };
}

async function popular(options) {
  return list((options && options.page) || 1, { orderBy: 'total_views' });
}

async function latest(options) {
  return list((options && options.page) || 1, { orderBy: SITE.latestSort || 'latest' });
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  return list(pageNumber || 1, {
    query: String(text || '').trim(),
    status: filters.status,
    orderBy: filters.sort,
    order: filters.ascending ? 'asc' : 'desc',
    tags: [].concat(filters.genres || []).filter(Boolean),
  });
}

async function getFilters() {
  var tags = await api('/tags').catch(function () { return []; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'total_views' },
    { type: 'toggle', key: 'ascending', name: 'Ascending', default: false },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: 'All' },
  ];
  if (Array.isArray(tags) && tags.length) {
    out.push({ type: 'multi', key: 'genres', name: 'Genres', options: tags.map(function (tag) { return { value: String(tag.id), label: tag.name }; }), default: [] });
  }
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

function descriptionOf(series) {
  var doc = parseHtml(series.description || '');
  var paragraphs = all(doc, 'p').map(textOf).filter(Boolean);
  var text = paragraphs.length ? paragraphs.join('\n\n') : textOf(doc);
  if (text === '-') text = '';
  var alt = String(series.alternative_names || '').split('|').map(function (name) { return name.trim(); })
    .filter(function (name) { return name && name !== series.title; });
  if (alt.length) text = (text ? text + '\n\n' : '') + 'Also known as: ' + alt.join(', ');
  return text;
}

/** Free chapters that are out already, one per number, oldest first. Paid ones need an account. */
async function chaptersOf(series) {
  var rows = [];
  for (var pageNumber = 1; pageNumber <= 20; pageNumber++) {
    var body = await api('/chapter/query?' + query({ page: pageNumber, perPage: 1000, series_id: series.id }));
    rows = rows.concat(body.data || []);
    var meta = body.meta || {};
    if (!(Number(meta.current_page) < Number(meta.last_page))) break;
  }
  var now = Date.now();
  var seen = {};
  var out = [];
  rows.slice().reverse().forEach(function (row) {
    if (row.price || (row.created_at && Date.parse(row.created_at) > now)) return;
    var name = String(row.chapter_name || '').trim();
    var number = numberOf(name, row.chapter_slug);
    if (number === null || seen[number]) return;
    seen[number] = true;
    out.push({
      url: seriesUrl(series.series_slug) + '/' + row.chapter_slug,
      title: row.chapter_title ? name + ' - ' + String(row.chapter_title).trim() : name,
      number: number,
      date: row.created_at || null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var series = await api('/series/' + slugOf(url));
  var chapters = await chaptersOf(series);
  var description = descriptionOf(series);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' without an account right now.' + (description ? '\n\n' + description : '');
  var people = [series.author, series.studio].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: series.title,
    cover: imageUrl(series.thumbnail),
    description: description,
    status: statusOf(series.status),
    genres: (series.tags || []).map(function (tag) { return tag.name; }).filter(Boolean).sort(),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    year: series.release_year ? Number(series.release_year) || null : null,
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await api('/series/' + slugOf(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var match = new RegExp('/' + SERIES_PATH + '/([^/?#]+)/([^/?#]+)').exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var body = await api('/chapter/' + match[1] + '/' + match[2]);
  var images = (body.chapter && body.chapter.chapter_data && body.chapter.chapter_data.images) || [];
  if (body.paywall && images.length === 0) throw new Error('This chapter is paid on ' + SITE.name + '.');
  return images.map(imageUrl).filter(Boolean).map(function (image) {
    return { url: image, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
