// MangAdventure (a Django reader with a JSON API at /api/v2, run by scanlation groups: Arc-Relight, Assorted Scans).
// Ported from Keiyoushi's MangAdventure (lib-multisrc/mangadventure in github.com/keiyoushi/extensions-source,
// Apache-2.0): its series, chapter and page endpoints, sort orders, statuses and filters.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   categories   the site's category names for the filter (MangAdventure's default list otherwise)
//
// @theme mangadventure
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = BASE + '/api/v2';
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var CATEGORIES = SITE.categories || ['4-Koma', 'Action', 'Adventure', 'Comedy', 'Doujinshi', 'Drama', 'Ecchi', 'Fantasy', 'Gender Bender',
  'Harem', 'Hentai', 'Historical', 'Horror', 'Josei', 'Martial Arts', 'Mecha', 'Mystery', 'Psychological', 'Romance', 'School Life',
  'Sci-Fi', 'Seinen', 'Shoujo', 'Shoujo Ai', 'Shounen', 'Shounen Ai', 'Slice of Life', 'Smut', 'Sports', 'Supernatural', 'Tragedy',
  'Yaoi', 'Yuri'];

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(API + path, { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' } });
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
  return BASE + '/reader/' + slug + '/';
}

function slugOf(url) {
  var match = /\/reader\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]);
}

function statusOf(series) {
  var status = String(series.status || '').toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'ongoing') return 'ongoing';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  return null;
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: titleUrl(series.slug), cover: series.cover || null, status: statusOf(series) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['-views', 'Views'], ['-latest_upload', 'Latest upload'], ['title', 'Title'], ['-chapter_count', 'Chapter count']];
var STATUSES = [['', 'Any'], ['completed', 'Completed'], ['ongoing', 'Ongoing'], ['hiatus', 'Hiatus'], ['canceled', 'Cancelled']];

async function list(params) {
  var body = await api('/series?' + query(params));
  return { items: (body.results || []).filter(function (series) { return series.slug; }).map(toItem), hasNextPage: body.last === false };
}

async function popular(options) {
  return list({ page: (options && options.page) || 1, sort: '-views' });
}

async function latest(options) {
  return list({ page: (options && options.page) || 1, sort: '-latest_upload' });
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  return list({
    page: pageNumber || 1,
    title: String(text || '').trim(),
    author: String(filters.author || '').trim(),
    artist: String(filters.artist || '').trim(),
    status: filters.status,
    sort: filters.sort,
    categories: [].concat(filters.categories || []).filter(Boolean).join(','),
  });
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  return [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: '-views' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'text', key: 'author', name: 'Author', default: '' },
    { type: 'text', key: 'artist', name: 'Artist', default: '' },
    { type: 'multi', key: 'categories', name: 'Categories', options: CATEGORIES.map(function (name) { return { value: name, label: name }; }), default: [] },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Chapters, one per number, oldest first. Final chapters are marked, as on the site. */
async function chaptersOf(slug) {
  var body = await api('/series/' + encodeURIComponent(slug) + '/chapters?date_format=timestamp');
  var seen = {};
  var out = [];
  (body.results || []).forEach(function (chapter) {
    var number = Number(chapter.number);
    if (!isFinite(number) || seen[number] || chapter.id === undefined) return;
    seen[number] = true;
    var published = Number(chapter.published);
    out.push({
      url: BASE + (chapter.url || '/reader/' + slug + '/') + '#' + chapter.id,
      title: String(chapter.full_title || chapter.title || 'Chapter ' + number).trim() + (chapter.final ? ' [END]' : ''),
      number: number,
      date: published > 0 ? new Date(published).toISOString() : null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var slug = slugOf(url);
  var series = await api('/series/' + encodeURIComponent(slug));
  var chapters = await chaptersOf(slug);
  var description = textOf(parseHtml(String(series.description || '').replace(/\r?\n/g, '<br>')));
  var aliases = (series.aliases || []).map(function (name) { return String(name).trim(); }).filter(Boolean);
  if (aliases.length) description = (description ? description + '\n\n' : '') + 'Also known as: ' + aliases.join(', ');
  if (series.licensed) description = 'Licensed: ' + SITE.name + ' may have taken its chapters down.' + (description ? '\n\n' + description : '');
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var people = (series.authors || []).concat(series.artists || []).map(function (name) { return String(name).trim(); }).filter(Boolean);
  return {
    title: String(series.title || '').trim(),
    cover: series.cover || null,
    description: description,
    status: statusOf(series),
    genres: (series.categories || []).slice(),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(slugOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** The chapter's API id rides after `#` on its reader link. */
async function getPages(url) {
  var match = /#(\d+)$/.exec(String(url));
  if (!match) throw new Error('Open the title again to refresh its chapters.');
  var body = await api('/chapters/' + match[1] + '/pages');
  var pages = (body.results || []).filter(function (one) { return one.image; })
    .sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages.map(function (one) {
    return { url: String(one.image).replace(/^http:\/\//, 'https://'), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
