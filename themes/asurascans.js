// Asura Scans (the group's own site, asurascans.com, over its JSON API at api.asurascans.com).
// Ported from Keiyoushi's Asura Scans (src/en/asurascans in github.com/keiyoushi/extensions-source, Apache-2.0):
// /api/series for lists, search and filters (sort and order, status, type, genres, minimum chapters), locked and
// early-access chapters, chapter names, and putting tiled pages back together.
//
// The build puts `var SITE = { id, name, lang, baseUrl, apiUrl };` above this file.
//
// Keiyoushi reads details, chapters and pages from the site's pages (Astro props); the API serves all three
// (/api/series/<slug>, /chapters, /chapters/<number>), with page sizes, so this uses it. The site's own links end in
// a random suffix that changes ("/comics/overgeared-11fe7da3"); titles here are kept as the bare slug.
// Premium and early-access chapters are left out. Tiled pages (`tiles`, `tile_cols`, `tile_rows`) go to Otavue as a
// scramble map; none of today's free chapters use them.
//
// @theme asurascans
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var PER_PAGE = 20;

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(API + path, { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  var text = await res.text();
  if (!res.ok) {
    if (/cf-chl|Just a moment/i.test(text)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  try { return JSON.parse(text); } catch (e) { throw new Error(SITE.name + ' answered with something other than its API.'); }
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
  if (status === 'dropped' || status === 'axed') return 'cancelled';
  return null;
}

function titleUrl(slug) {
  return BASE + '/comics/' + slug;
}

/** The series slug from a title or chapter link, without the site's random suffix. */
function slugOf(url) {
  var match = /\/(?:comics|series)\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]).replace(/-[a-z0-9]{8}$/, '');
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: titleUrl(series.slug), cover: https(series.cover || series.cover_url || series.coverUrl), status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function seriesPage(params, pageNumber) {
  var query = ['offset=' + ((pageNumber || 1) - 1) * PER_PAGE, 'limit=' + PER_PAGE];
  for (var key in params) if (params[key]) query.push(key + '=' + encodeURIComponent(params[key]));
  var body = await api('/series?' + query.join('&'));
  return {
    items: (body.data || []).filter(function (series) { return series.slug && series.title; }).map(toItem),
    hasNextPage: Boolean(body.meta && body.meta.has_more),
  };
}

async function popular(options) {
  return seriesPage({ sort: 'popular', order: 'desc' }, (options && options.page) || 1);
}

async function latest(options) {
  return seriesPage({ sort: 'latest', order: 'desc' }, (options && options.page) || 1);
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  var genres = Array.isArray(filters.genres) ? filters.genres : filters.genres ? [filters.genres] : [];
  var minimum = String(filters.minChapters || '').replace(/\D+/g, '');
  return seriesPage({
    search: String(text || '').trim(),
    sort: filters.sort || 'latest',
    order: filters.ascending ? 'asc' : 'desc',
    status: filters.status,
    type: filters.type,
    genres: genres.join(','),
    min_chapters: minimum,
  }, pageNumber || 1);
}

var SORTS = [['latest', 'Latest update'], ['popular', 'Popular'], ['rating', 'Rating'], ['title', 'A-Z'], ['update', 'Newest']];
var STATUSES = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['dropped', 'Dropped'], ['axed', 'Axed']];
var TYPES = [['', 'All'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['manga', 'Mangatoon']];

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var genres = [];
  try {
    genres = ((await api('/genres')).data || []).map(function (genre) { return { value: genre.slug, label: genre.name }; });
  } catch (e) { genres = []; }
  var filters = [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'latest' },
    { type: 'toggle', key: 'ascending', name: 'Ascending', default: false },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
  ];
  if (genres.length) filters.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
  filters.push({ type: 'text', key: 'minChapters', name: 'Minimum chapters', placeholder: '50', default: '' });
  return filters;
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Locked: premium, or early access that hasn't ended. */
function isLocked(chapter, now) {
  if (chapter.is_premium || chapter.is_locked) return true;
  var until = Date.parse(chapter.early_access_until || '');
  return isFinite(until) && until > now;
}

function numberText(number) {
  return String(Number(number));
}

/** Free chapters, one per number, oldest first: "Chapter 344 - Saharan vs. Valhalla". */
async function chaptersOf(slug) {
  var rows = (await api('/series/' + encodeURIComponent(slug) + '/chapters')).data || [];
  var now = Date.now();
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    var number = Number(row.number);
    if (!isFinite(number) || seen[number] || isLocked(row, now)) return;
    seen[number] = true;
    var title = String(row.title || '').trim();
    out.push({
      url: titleUrl(slug) + '/chapter/' + numberText(number),
      title: 'Chapter ' + numberText(number) + (title ? ' - ' + title : ''),
      number: number,
      date: row.published_at || row.created_at || null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

/** Text from the description's HTML. */
function plain(html) {
  return String(html || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

async function getDetail(url) {
  var slug = slugOf(url);
  var series = (await api('/series/' + encodeURIComponent(slug))).series;
  if (!series || !series.title) throw new Error(SITE.name + ' no longer has this.');
  var chapters = await chaptersOf(series.slug || slug);
  var description = plain(series.description);
  var also = String(series.alternative_titles || '').split(/\s*•\s*|\s*,\s*/).map(function (name) { return name.trim(); })
    .filter(function (name) { return name && name !== series.title; });
  if (also.length) description += (description ? '\n\n' : '') + 'Also known as: ' + also.join(', ');
  if (chapters.length === 0) description = 'No free chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = (series.genres || []).map(function (genre) { return genre && genre.name; }).filter(Boolean);
  if (series.type) genres.unshift(String(series.type).charAt(0).toUpperCase() + String(series.type).slice(1));
  var authors = [series.author, series.artist].join('/').split(/\s*\/\s*|\s*,\s*/).filter(Boolean);
  return {
    title: String(series.title).trim(),
    cover: https(series.cover),
    description: description,
    status: statusOf(series.status),
    genres: genres,
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(slugOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/**
 * Asura's tiles: the image's tile `w` (counted along rows) belongs at place `tiles[w]`. Otavue's map says which
 * tile is drawn at each place, so map[tiles[w]] = w.
 */
function scrambleOf(page) {
  if (!Array.isArray(page.tiles) || page.tiles.length === 0) return null;
  var cols = Number(page.tile_cols) || 4;
  var rows = Number(page.tile_rows) || 5;
  var map = new Array(cols * rows);
  page.tiles.forEach(function (place, tile) { map[Number(place)] = tile; });
  var complete = page.tiles.length === cols * rows && map.every(function (tile) { return typeof tile === 'number'; });
  // A page that can't be put back would show jumbled; better to say so.
  if (!complete) throw new Error(SITE.name + ' sent a page Otavue can’t put together.');
  return { cols: cols, rows: rows, align: 1, map: map };
}

async function getPages(url) {
  var match = /\/(?:comics|series)\/([^\/?#]+)\/chapter\/([\d.]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var slug = decodeURIComponent(match[1]).replace(/-[a-z0-9]{8}$/, '');
  var data = (await api('/series/' + encodeURIComponent(slug) + '/chapters/' + match[2])).data || {};
  var chapter = data.chapter || {};
  if (isLocked(chapter, Date.now())) throw new Error('This chapter isn’t free to read on ' + SITE.name + ' yet.');
  var pages = (chapter.pages || []).filter(function (page) { return page && page.url; }).map(function (page) {
    var out = { url: https(page.url), headers: { 'User-Agent': AGENT } };
    if (page.width && page.height) { out.width = page.width; out.height = page.height; }
    var scramble = scrambleOf(page);
    if (scramble) out.scramble = scramble;
    return out;
  });
  if (pages.length === 0) throw new Error('This chapter isn’t free to read on ' + SITE.name + '.');
  return pages;
}
