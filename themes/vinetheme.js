// VineTheme (a Next.js reader used by scanlation groups: Drake Scans, Valir Scans, WitchScans and others).
// Ported from Keiyoushi's VineTheme (lib-multisrc/vinetheme in github.com/keiyoushi/extensions-source, Apache-2.0):
// its /api/series lists and filters, and reading titles, chapters and pages from the pages' RSC data.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file, one copy per site.
//
// Lists come from JSON (`/api/series`). Titles and chapters only come as React Server Components data: a page
// fetched with `rsc: 1` answers with "id:JSON" rows, and the objects wanted are found inside them by shape.
// Pages flagged as encrypted or tiled still have a plain image at `imageUrl`, which is what's read.
//
// @theme vinetheme
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var SERIES_PATH = '/series/comic/';
var PER_PAGE = 24;
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url, extra) {
  var headers = { 'User-Agent': AGENT, Referer: BASE + '/' };
  for (var key in extra || {}) headers[key] = extra[key];
  var res = await fetch(url, { headers: headers });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  return res;
}

function query(params) {
  return Object.keys(params).filter(function (key) { return params[key] !== '' && params[key] !== undefined && params[key] !== null; })
    .map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
}

async function api(params) {
  var res = await request(BASE + '/api/series?' + query(params), { Accept: 'application/json' });
  return res.json();
}

/** Where `bytes` UTF-8 bytes from `start` end in `text` (text rows give their length in bytes). */
function byteEnd(text, start, bytes) {
  var i = start;
  while (bytes > 0 && i < text.length) {
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { bytes -= 4; i += 2; } else { bytes -= code < 0x80 ? 1 : code < 0x800 ? 2 : 3; i += 1; }
  }
  return i;
}

/**
 * RSC rows by id. Most are "id:JSON\n"; text rows are "id:T<hex byte length>,<text>" with no newline after
 * them, so they're cut by length, not by line.
 */
function rscRows(text) {
  var rows = {};
  var i = 0;
  while (i < text.length) {
    var colon = text.indexOf(':', i);
    if (colon < 0) break;
    var id = text.slice(i, colon).replace(/^\s+/, '');
    var text_ = /^T([0-9a-f]+),/.exec(text.slice(colon + 1, colon + 20));
    if (text_) {
      var start = colon + 1 + text_[0].length;
      var end = byteEnd(text, start, parseInt(text_[1], 16));
      rows[id] = text.slice(start, end);
      i = end;
      continue;
    }
    var newline = text.indexOf('\n', colon);
    if (newline < 0) newline = text.length;
    var body = text.slice(colon + 1, newline);
    if (body[0] === '{' || body[0] === '[' || body[0] === '"') {
      try { rows[id] = JSON.parse(body); } catch (e) { /* not JSON */ }
    }
    i = newline + 1;
  }
  return rows;
}

/** A value with its "$<id>" references to other rows (long text, outlined arrays) filled in, `levels` deep. */
function resolved(value, rows, levels) {
  if (typeof value === 'string') {
    var ref = /^\$([0-9a-f]+)$/.exec(value);
    return ref && rows[ref[1]] !== undefined ? resolved(rows[ref[1]], rows, levels) : value;
  }
  if (!value || typeof value !== 'object' || levels <= 0) return value;
  var out = Array.isArray(value) ? [] : {};
  for (var key in value) out[key] = resolved(value[key], rows, levels - 1);
  return out;
}

/** The first object in a page's RSC rows that passes `test` (after references are filled in). */
async function rscFind(url, test) {
  var res = await request(url, { rsc: '1', Accept: 'text/x-component' });
  var rows = rscRows(String(await res.text()));
  var found = null;
  var walk = function (value, depth) {
    if (found || !value || typeof value !== 'object' || depth > 40) return;
    // A shallow look first; the whole object is only filled in once it's the one wanted.
    if (!Array.isArray(value) && test(resolved(value, rows, 2))) { found = resolved(value, rows, 12); return; }
    for (var key in value) walk(value[key], depth + 1);
  };
  for (var id in rows) {
    walk(rows[id], 0);
    if (found) break;
  }
  return found;
}

/** A string from RSC data: "$$x" is a literal "$x", "$D…" a date, and any other "$…" a reference or undefined. */
function value(text) {
  if (typeof text !== 'string') return text === undefined ? null : text;
  if (text.slice(0, 2) === '$$') return text.slice(1);
  if (text.slice(0, 2) === '$D') return text.slice(2);
  return text[0] === '$' ? null : text;
}

/* ── links ────────────────────────────────────────────────────────────── */

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

function slugOf(series) {
  return value(series.urlSlug) || value(series.slug) || '';
}

/**
 * The site's own link (".../series/comic/<slug><suffix>"). A few slugs are too long for Otavue's 150-byte ids;
 * those are cut short at a word and carry the series id after `#`, and the full slug is looked up when needed.
 */
function linkOf(slug, id, suffix) {
  var url = BASE + SERIES_PATH + slug + suffix;
  if (byteLength(url) <= MAX_URL_BYTES) return url;
  var room = MAX_URL_BYTES - byteLength(BASE + SERIES_PATH + suffix + '#' + id);
  var short = slug.slice(0, Math.max(room, 1));
  if (short.length < slug.length && short.indexOf('-') > 0) short = short.slice(0, short.lastIndexOf('-'));
  return BASE + SERIES_PATH + short + suffix + '#' + id;
}

/** `{ slug, id }` from a title or chapter link; `id` only when the slug was cut short. */
function partsOf(url) {
  var match = new RegExp('/series/comic/([^/?#]+)(?:/chapter/([^/?#]+))?[^#]*(?:#(.+))?$').exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return { slug: decodeURIComponent(match[1]), chapter: match[2] || null, id: match[3] || null };
}

/** The full slug for a cut-short link: the API's search by the slug's first words, matched on the id. */
async function fullSlug(parts) {
  if (!parts.id) return parts.slug;
  var words = parts.slug.split('-').filter(Boolean);
  var longest = words.slice().sort(function (a, b) { return b.length - a.length; })[0] || '';
  var tries = [words.slice(0, 3).join(' '), words.slice(0, 2).join(' '), longest];
  for (var i = 0; i < tries.length; i++) {
    if (!tries[i] || tries.indexOf(tries[i]) < i) continue;
    var body = await api({ contentMode: 'comics', q: tries[i], page: 1, limit: PER_PAGE });
    var hit = (body.data || []).filter(function (series) { return series.id === parts.id; })[0];
    if (hit) return slugOf(hit);
  }
  throw new Error(SITE.name + ' no longer has this.');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function imageUrl(path) {
  path = value(path);
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path.replace(/^http:\/\//, 'https://');
  return BASE + '/' + String(path).replace(/^\/+/, '');
}

function statusOf(text) {
  var status = String(value(text) || '').toUpperCase();
  if (status === 'ONGOING' || status === 'UPCOMING') return 'ongoing';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'HIATUS') return 'hiatus';
  if (status === 'DROPPED' || status === 'CANCELLED' || status === 'DISCONTINUED') return 'cancelled';
  return null;
}

function toItem(series) {
  var slug = slugOf(series);
  return { title: String(value(series.title) || '').trim(), url: slug ? linkOf(slug, series.id, '') : '', cover: imageUrl(series.coverImage), coverHeaders: COVER_HEADERS, status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['popular', 'Most bookmarked'], ['updated', 'Recently updated'], ['views', 'Most viewed'], ['trending', 'Trending'], ['rating', 'Top rated'], ['newest', 'Newest'], ['longest', 'Longest']];
var TYPES = [['', 'All'], ['Manhwa', 'Manhwa'], ['Manhua', 'Manhua'], ['Manga', 'Manga'], ['Webtoon', 'Webtoon']];
var STATUSES = [['', 'All'], ['Ongoing', 'Ongoing'], ['Completed', 'Completed'], ['Hiatus', 'Hiatus'], ['Dropped', 'Dropped'], ['Discontinued', 'Discontinued'], ['Upcoming', 'Upcoming']];
var ORIGINS = [['', 'All'], ['KOREAN', 'Korean'], ['JAPANESE', 'Japanese'], ['CHINESE', 'Chinese'], ['OTHER', 'Other']];

async function list(pageNumber, params) {
  params.contentMode = 'comics';
  params.page = pageNumber;
  params.limit = PER_PAGE;
  var body = await api(params);
  return {
    items: (body.data || []).map(toItem).filter(function (item) { return item.title && item.url; }),
    hasNextPage: Boolean(body.meta && body.meta.hasMore),
  };
}

async function popular(options) {
  return list((options && options.page) || 1, { sort: 'popular' });
}

async function latest(options) {
  return list((options && options.page) || 1, { sort: 'updated' });
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  return list(pageNumber || 1, {
    q: String(text || '').trim(),
    sort: filters.sort,
    type: filters.type,
    status: filters.status,
    origin: filters.origin,
    genre: [].concat(filters.genres || []).filter(Boolean).join(','),
  });
}

/** Genres with titles in them, from the /series page's data (it holds the counts as `tagTotal`'s neighbours). */
async function getFilters() {
  var data = await rscFind(BASE + '/series', function (x) { return 'tagTotal' in x; }).catch(function () { return null; });
  var genres = ((data && data.genres) || []).filter(function (genre) { return genre.count !== 0; }).map(function (genre) {
    var slug = value(genre.slug) || (genre.genre && value(genre.genre.slug)) || '';
    var name = String(value(genre.name) || slug).replace(/[^\x20-\x7e\p{L}\p{N}-]+/gu, '').trim();
    return { value: slug, label: name };
  }).filter(function (genre) { return genre.value && genre.label; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'popular' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'origin', name: 'Origin', options: options(ORIGINS), default: '' },
  ];
  if (genres.length) out.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

function isDetail(x) {
  return 'series' in x && 'chapters' in x && Array.isArray(x.chapters);
}

function descriptionOf(series) {
  var doc = parseHtml(String(value(series.description) || '').replace(/\r?\n/g, '<br>'));
  var text = all(doc, 'p').map(textOf).filter(Boolean).join('\n\n') || textOf(doc);
  var title = String(value(series.title) || '').toLowerCase();
  var names = [value(series.originalTitle)].concat(series.aliases || []).map(function (name) { return String(value(name) || '').trim(); })
    .filter(function (name, i, list) { return name && name.toLowerCase() !== title && list.indexOf(name) === i; });
  if (names.length) text = (text ? text + '\n\n' : '') + 'Also known as: ' + names.join(', ');
  return text;
}

/** Chapters that need coins, or aren't out to everyone yet, need an account. */
function isLocked(chapter) {
  return Boolean(chapter.isLocked) || chapter.hasAccess === false;
}

/** Every page of a title's chapter list (100 a page), newest first as the site sorts them. */
async function chapterRows(slug, first) {
  var rows = (first.chapters || []).slice();
  var pages = Math.min(Number(first.totalPages) || 1, 30);
  for (var pageNumber = 2; pageNumber <= pages; pageNumber++) {
    var more = await rscFind(BASE + SERIES_PATH + slug + '?sort=desc&page=' + pageNumber, isDetail);
    rows = rows.concat((more && more.chapters) || []);
  }
  return rows;
}

/** Free chapters, one per number, oldest first. */
function chaptersOf(series, rows) {
  var slug = slugOf(series);
  var seen = {};
  var out = [];
  rows.forEach(function (chapter) {
    if (isLocked(chapter)) return;
    var number = Number(chapter.number);
    if (!isFinite(number) || seen[number]) return;
    seen[number] = true;
    var name = String(value(chapter.title) || '').trim();
    out.push({
      url: linkOf(slug, series.id, '/chapter/' + number),
      title: !name || name === String(number) ? 'Chapter ' + number : /^chapter\b/i.test(name) ? name : 'Chapter ' + number + ' - ' + name,
      number: number,
      date: value(chapter.publishedAt),
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function load(url) {
  var slug = await fullSlug(partsOf(url));
  var detail = await rscFind(BASE + SERIES_PATH + slug + '?sort=desc', isDetail);
  if (!detail || !detail.series) throw new Error(SITE.name + ' no longer has this.');
  return { detail: detail, slug: slug };
}

async function getDetail(url) {
  var loaded = await load(url);
  var series = loaded.detail.series;
  var chapters = chaptersOf(series, await chapterRows(loaded.slug, loaded.detail));
  var description = descriptionOf(series);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' without an account right now.' + (description ? '\n\n' + description : '');
  var type = String(value(series.type) || '');
  var genres = (series.genres || []).concat(series.tags || []).map(function (genre) { return String(value(genre.name) || '').trim(); }).filter(Boolean);
  if (type) genres.unshift(type.charAt(0) + type.slice(1).toLowerCase());
  return {
    title: String(value(series.title) || '').trim(),
    cover: imageUrl(series.coverImage),
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(series.status),
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  var loaded = await load(url);
  return chaptersOf(loaded.detail.series, await chapterRows(loaded.slug, loaded.detail));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var parts = partsOf(url);
  if (!parts.chapter) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var slug = await fullSlug(parts);
  var data = await rscFind(BASE + SERIES_PATH + slug + '/chapter/' + parts.chapter, function (x) {
    return x.chapter && typeof x.chapter === 'object' && Array.isArray(x.chapter.pages);
  });
  var pages = ((data && data.chapter.pages) || []).filter(function (page) { return value(page.imageUrl) && !page.isRedacted; });
  if (pages.length === 0) {
    if (data && data.isLocked && !data.isUnlocked) throw new Error('This chapter is locked on ' + SITE.name + '.');
    throw new Error('This chapter has no pages on ' + SITE.name + '.');
  }
  return pages.map(function (page) {
    var out = { url: imageUrl(page.imageUrl), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
    if (page.width > 0 && page.height > 0) { out.width = page.width; out.height = page.height; }
    return out;
  });
}
