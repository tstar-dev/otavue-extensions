// Webdex Scans (the group's own site, webdexscans.com, over its Supabase REST API).
// Ported from Keiyoushi's Webdex Scans (src/en/webdexscans in github.com/keiyoushi/extensions-source, Apache-2.0):
// /series, /chapters and /pages through PostgREST with the site's public anon key, the sort, genre, type and status
// filters, chapter names, and premium chapters (until their free_at).
//
// The build puts `var SITE = { id, name, lang, baseUrl, supabaseUrl, supabaseKey };` above this file.
//
// Images are kept on the site as /wp-content/uploads/…, which redirects to cdn.webdexscans.com; the site turns away
// requests without a browser's User-Agent, the CDN doesn't, so images go to the CDN directly. Premium chapters are
// left out until they turn free.
//
// @theme webdexscans
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var REST = String(SITE.supabaseUrl).replace(/\/+$/, '') + '/rest/v1';
var CDN = 'https://cdn.webdexscans.com';
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var PER_PAGE = 24;

/* ── requests ─────────────────────────────────────────────────────────── */

function query(pairs) {
  return pairs.filter(function (pair) { return pair[1] !== undefined && pair[1] !== null && pair[1] !== ''; })
    .map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

/** A PostgREST table read; `{ rows, total }`, total from Content-Range when counted. */
async function table(name, pairs, count) {
  var headers = { 'User-Agent': AGENT, Accept: 'application/json', apikey: SITE.supabaseKey, authorization: 'Bearer ' + SITE.supabaseKey };
  if (count) headers.Prefer = 'count=exact';
  var res = await fetch(REST + '/' + name + '?' + query(pairs), { headers: headers });
  var text = await res.text();
  if (!res.ok) throw new Error(SITE.name + ' answered ' + res.status + '.');
  var rows;
  try { rows = JSON.parse(text); } catch (e) { throw new Error(SITE.name + ' answered with something other than its API.'); }
  var range = String((res.headers || {})['content-range'] || '');
  var total = /\/(\d+)$/.exec(range);
  return { rows: Array.isArray(rows) ? rows : [], total: total ? Number(total[1]) : null };
}

/** The CDN copy of a site upload; anything else made absolute. */
function image(path) {
  if (!path) return null;
  path = String(path);
  var upload = /^(?:https?:\/\/(?:www\.)?webdexscans\.com)?\/wp-content\/uploads(\/.*)$/.exec(path);
  if (upload) return CDN + upload[1];
  if (/^https?:\/\//.test(path)) return path.replace(/^http:\/\//, 'https://');
  return BASE + (path.charAt(0) === '/' ? '' : '/') + path;
}

/* ── titles ───────────────────────────────────────────────────────────── */

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (status === 'ongoing') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'cancelled' || status === 'dropped') return 'cancelled';
  return null;
}

function titleUrl(slug) {
  return BASE + '/series/' + slug;
}

function slugOf(url) {
  var match = /\/series\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]);
}

/* ── lists ────────────────────────────────────────────────────────────── */

var ORDERS = { latest: 'updated_at.desc', popular: 'view_count.desc', rating: 'rating.desc', 'a-z': 'title.asc' };

async function seriesPage(pairs, sort, pageNumber) {
  var offset = ((pageNumber || 1) - 1) * PER_PAGE;
  var base = [['order', ORDERS[sort] || ORDERS.latest], ['offset', offset], ['limit', PER_PAGE]];
  var result = await table('series', pairs.concat(base), true);
  var items = result.rows.filter(function (row) { return row.slug && row.title; })
    .map(function (row) { return { title: String(row.title).trim(), url: titleUrl(row.slug), cover: image(row.cover_url) }; });
  var more = result.total !== null ? offset + result.rows.length < result.total : result.rows.length === PER_PAGE;
  return { items: items, hasNextPage: more };
}

async function popular(options) {
  return seriesPage([['select', 'id,title,slug,cover_url']], 'popular', (options && options.page) || 1);
}

async function latest(options) {
  return seriesPage([['select', 'id,title,slug,cover_url']], 'latest', (options && options.page) || 1);
}

var SORTS = [['latest', 'Latest update'], ['popular', 'Most popular'], ['rating', 'Highest rating'], ['a-z', 'Alphabetical']];
var TYPES = [['', 'All types'], ['manhwa', 'Manhwa'], ['manga', 'Manga'], ['manhua', 'Manhua'], ['webtoon', 'Webtoon']];
var STATUSES = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus']];

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  var words = String(text || '').trim().replace(/[%*,()]/g, ' ').trim();
  var pairs = [];
  if (filters.genre) pairs.push(['select', 'id,title,slug,cover_url,genres!inner(slug)'], ['genres.slug', 'eq.' + filters.genre]);
  else pairs.push(['select', 'id,title,slug,cover_url']);
  if (words) pairs.push(['title', 'ilike.*' + words + '*']);
  if (filters.type) pairs.push(['type', 'eq.' + filters.type]);
  if (filters.status) pairs.push(['status', 'eq.' + filters.status]);
  return seriesPage(pairs, filters.sort || 'latest', pageNumber || 1);
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var genres = [];
  try {
    genres = (await table('genres', [['select', 'name,slug'], ['order', 'name.asc']])).rows
      .filter(function (row) { return row.slug && row.name; }).map(function (row) { return { value: row.slug, label: row.name }; });
  } catch (e) { genres = []; }
  return [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'latest' },
    { type: 'select', key: 'genre', name: 'Genre', options: [{ value: '', label: 'All genres' }].concat(genres), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

async function seriesBySlug(slug) {
  var row = (await table('series', [['slug', 'eq.' + slug], ['select', '*,genres(name)']])).rows[0];
  if (!row) throw new Error(SITE.name + ' no longer has this.');
  return row;
}

/** Locked: premium and not yet free. */
function isLocked(row, now) {
  if (!row.is_premium) return false;
  var free = Date.parse(row.free_at || '');
  return !isFinite(free) || free > now;
}

/** Free chapters, one per number, oldest first. */
async function chaptersOf(series) {
  var rows = (await table('chapters', [['series_id', 'eq.' + series.id], ['select', 'id,chapter_number,title,slug,created_at,is_premium,free_at'], ['order', 'chapter_number.asc']])).rows;
  var now = Date.now();
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    var number = Number(row.chapter_number);
    if (row.chapter_number === null || !isFinite(number) || seen[number] || !row.id || !row.slug || isLocked(row, now)) return;
    seen[number] = true;
    var title = String(row.title || '').trim();
    out.push({
      url: titleUrl(series.slug) + '/' + row.slug + '#' + row.id,
      title: title || 'Chapter ' + number,
      number: number,
      date: row.created_at ? new Date(row.created_at).toISOString() : null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

/** Text from the description's HTML. */
function plain(html) {
  return String(html || '').replace(/<\/(?:p|div|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t\r]*\n[ \t\r]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function getDetail(url) {
  var series = await seriesBySlug(slugOf(url));
  var chapters = await chaptersOf(series);
  var description = plain(series.description);
  var also = String(series.alternative_titles || '').trim();
  if (also) description += (description ? '\n\n' : '') + 'Also known as: ' + also;
  if (chapters.length === 0) description = 'No free chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = (series.genres || []).map(function (genre) { return genre && genre.name; }).filter(Boolean);
  if (series.type) genres.unshift(String(series.type).charAt(0).toUpperCase() + String(series.type).slice(1));
  var authors = [series.author, series.artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(series.title || '').trim(),
    cover: image(series.cover_url),
    description: description,
    status: statusOf(series.status),
    genres: genres,
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await seriesBySlug(slugOf(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var id = (/#([0-9a-f-]{36})$/.exec(String(url)) || [])[1];
  if (!id) {
    // A link without the chapter's id: find it by its slug.
    var match = /\/series\/([^\/?#]+)\/([^\/?#]+)/.exec(String(url));
    if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
    var series = await seriesBySlug(decodeURIComponent(match[1]));
    var row = (await table('chapters', [['series_id', 'eq.' + series.id], ['slug', 'eq.' + decodeURIComponent(match[2])], ['select', 'id,is_premium,free_at']])).rows[0];
    if (!row) throw new Error(SITE.name + ' no longer has this.');
    if (isLocked(row, Date.now())) throw new Error('This chapter isn’t free to read on ' + SITE.name + ' yet.');
    id = row.id;
  }
  var rows = (await table('pages', [['chapter_id', 'eq.' + id], ['select', 'image_url,page_number'], ['order', 'page_number.asc']])).rows;
  var pages = rows.map(function (row) { return image(row.image_url); }).filter(Boolean);
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages.map(function (page) { return { url: page, headers: { 'User-Agent': AGENT } }; });
}
