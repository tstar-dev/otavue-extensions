// MangaReader (the mangareader.to clone; MangaNow at manganow.to).
// Ported from Keiyoushi's MangaReader and MangaNow (lib-multisrc/mangareader and src/en/manganow in
// github.com/keiyoushi/extensions-source, Apache-2.0): /filter/ and /search lists, the title page's details and
// chapter list, the chapter's reading id and the /ajax/image/list/<id> pages, and MangaNow's filters.
//
// The build puts `var SITE = { id, name, lang, baseUrl, chaptersList? };` above this file, one copy per site.
//
// MangaNow's pages are hot-linked from mangaread.org, which refuses MangaNow as Referer (403) but takes its own
// address; each page is sent with its image host as Referer. The reader's first card is the site's banner.
// Chapter links carry the reading id after `#` once a page list has been read; the chapter list has none.
//
// @theme mangareader
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var CHAPTERS_LIST = SITE.chaptersList || 'en-chapters';

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
    if (/cf-chl|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  return res;
}

async function page(url) {
  var res = await request(url);
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  return doc;
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href || /^data:/.test(href)) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function imageOf(el, base) {
  return absolute(attr(el, 'data-lazy-src') || attr(el, 'data-src') || attr(el, 'data-url') || attr(el, 'src'), base);
}

/* ── lists ────────────────────────────────────────────────────────────── */

function itemsOf(doc) {
  var seen = {};
  var items = [];
  all(doc, '.manga_list-sbs .manga-poster').forEach(function (poster) {
    var url = absolute(attr(poster, 'href'), doc.url).replace(/[?#].*$/, '');
    var img = first(poster, 'img');
    var title = clean(attr(img, 'alt'));
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: imageOf(img, doc.url) || null });
  });
  return { items: items, hasNextPage: Boolean(first(doc, 'ul.pagination > li.active + li')) };
}

function filterUrl(params, pageNumber) {
  var query = [];
  for (var key in params) if (params[key]) query.push(key + '=' + encodeURIComponent(params[key]));
  query.push('page=' + (pageNumber || 1));
  return BASE + '/filter/?' + query.join('&');
}

async function popular(options) {
  return itemsOf(await page(filterUrl({ sort: 'most-viewed' }, (options && options.page) || 1)));
}

async function latest(options) {
  return itemsOf(await page(filterUrl({ sort: 'latest-updated' }, (options && options.page) || 1)));
}

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  if (query) return itemsOf(await page(BASE + '/search?keyword=' + encodeURIComponent(query) + '&page=' + (pageNumber || 1)));
  var filters = (options && options.filters) || {};
  var genres = Array.isArray(filters.genres) ? filters.genres : filters.genres ? [filters.genres] : [];
  return itemsOf(await page(filterUrl({
    type: filters.type, status: filters.status, score: filters.score, sy: filters.year, sort: filters.sort || 'default', genres: genres.join(','),
  }, pageNumber || 1)));
}

var SORTS = [['default', 'Default'], ['latest-updated', 'Latest updated'], ['score', 'Score'], ['name-az', 'Name A-Z'], ['release-date', 'Release date'], ['most-viewed', 'Most viewed']];
var TYPES = [['', 'All'], ['8', 'Manga'], ['53', 'Manhua'], ['39', 'Manhwa'], ['169', 'OEL'], ['344', 'Web Comic'], ['983', 'Webtoon']];
var STATUSES = [['', 'All'], ['completed', 'Completed'], ['ongoing', 'Ongoing'], ['on-hiatus', 'On hiatus'], ['discontinued', 'Discontinued'], ['not-yet-published', 'Not yet published']];
var SCORES = [['', 'All'], ['1', '(1) Appalling'], ['2', '(2) Horrible'], ['3', '(3) Very bad'], ['4', '(4) Bad'], ['5', '(5) Average'], ['6', '(6) Fine'],
  ['7', '(7) Good'], ['8', '(8) Very good'], ['9', '(9) Great'], ['10', '(10) Masterpiece']];
var GENRES = [
  ['1', 'Action'], ['2', 'Adventure'], ['641', 'Animated'], ['375', 'Anime'], ['463', 'Cartoon'], ['3', 'Comedy'], ['200', 'Comic'],
  ['326', 'Completed'], ['133', 'Cooking'], ['386', 'Detective'], ['534', 'Doujinshi'], ['10', 'Drama'], ['41', 'Ecchi'], ['17', 'Fantasy'],
  ['89', 'Gender Bender'], ['11', 'Harem'], ['30', 'Historical'], ['21', 'Horror'], ['70', 'Isekai'], ['67', 'Josei'], ['420', 'Magic'],
  ['137', 'Manga'], ['51', 'Manhua'], ['79', 'Manhwa'], ['12', 'Martial Arts'], ['22', 'Mature'], ['72', 'Mecha'], ['1180', 'Military'],
  ['44', 'Mystery'], ['721', 'One shot'], ['23', 'Psychological'], ['1603', 'Reincarnation'], ['13', 'Romance'], ['4', 'School Life'],
  ['24', 'Sci-fi'], ['25', 'Seinen'], ['33', 'Shoujo'], ['123', 'Shoujo Ai'], ['5', 'Shounen'], ['680', 'Shounen Ai'], ['14', 'Slice of Life'],
  ['734', 'Smut'], ['142', 'Sports'], ['28', 'Super Power'], ['6', 'Supernatural'], ['1816', 'Thriller'], ['97', 'Tragedy'], ['60', 'Webtoon'],
];

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var years = [['', 'Any']];
  for (var year = new Date().getUTCFullYear() + 1; year >= 1917; year--) years.push([String(year), String(year)]);
  return [
    { type: 'select', key: 'type', name: 'Type (filters are ignored when searching by text)', options: options(TYPES), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'score', name: 'Score', options: options(SCORES), default: '' },
    { type: 'select', key: 'year', name: 'Release year', options: options(years), default: '' },
    { type: 'select', key: 'sort', name: 'Sort', options: options(SORTS), default: 'default' },
    { type: 'multi', key: 'genres', name: 'Genres', options: options(GENRES), default: [] },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

function titleUrl(url) {
  var match = /^https?:\/\/[^\/]+\/manga\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return BASE + '/manga/' + match[1];
}

function statusOf(text) {
  var status = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (/^(ongoing|publishing|releasing)$/.test(status)) return 'ongoing';
  if (/^(completed|finished)$/.test(status)) return 'completed';
  if (/^(on-hold|on_hiatus|on-hiatus)$/.test(status)) return 'hiatus';
  if (/^(canceled|cancelled|discontinued)$/.test(status)) return 'cancelled';
  return null;
}

/** The info row headed `label` ("Authors:"). */
function infoRow(detail, label) {
  return all(detail, '.anisc-info > .item').filter(function (item) { return ownText(first(item, '.item-head')) === label; })[0] || null;
}

/** The chapters on the title page (the site's own language list), one per number, oldest first. */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, '#' + CHAPTERS_LIST + ' > li.chapter-item').forEach(function (row) {
    var link = first(row, 'a');
    var url = absolute(attr(link, 'href'), doc.url);
    var name = textOf(first(link, '.name')) || textOf(link);
    var number = attr(row, 'data-number') !== '' && isFinite(Number(attr(row, 'data-number'))) ? Number(attr(row, 'data-number')) : numberOf(name, url);
    if (!url || number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: url + (attr(row, 'data-id') ? '#' + attr(row, 'data-id') : ''), title: name, number: number, date: null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await page(titleUrl(url));
  var detail = first(doc, '#ani_detail');
  if (!detail) throw new Error(SITE.name + ' no longer has this.');
  var title = ownText(first(detail, '.manga-name')) || textOf(first(detail, '.manga-name'));
  var chapters = chaptersOf(doc);
  var description = ownText(first(detail, '.description')).replace(/^A brief description of the manga .*?:\s*/i, '');
  var also = ownText(first(detail, '.manga-name-or'));
  if (also && also !== title) description += (description ? '\n\n' : '') + 'Also known as: ' + also;
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var names = function (label) { var row = infoRow(detail, label); return row ? all(row, 'a').map(function (a) { return textOf(a).replace(/,$/, ''); }).filter(Boolean) : []; };
  var authors = names('Authors:').concat(names('Artists:'));
  var type = textOf(first(infoRow(detail, 'Type:'), '.name'));
  var genres = all(detail, '.genres > a').map(textOf).filter(Boolean);
  if (type) genres.push(type.charAt(0).toUpperCase() + type.slice(1));
  return {
    title: title,
    cover: imageOf(first(detail, '.manga-poster img'), doc.url) || null,
    description: description,
    status: statusOf(textOf(first(infoRow(detail, 'Status:'), '.name'))),
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(titleUrl(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

function originOf(url) {
  var match = /^(https:\/\/[^\/]+)/.exec(url);
  return match ? match[1] + '/' : BASE + '/';
}

async function getPages(url) {
  var link = String(url).replace(/#.*$/, '');
  var readingId = (/#(\d+)$/.exec(String(url)) || [])[1];
  if (!readingId) readingId = attr(first(await page(link), 'div[data-reading-id]'), 'data-reading-id');
  if (!readingId) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  var res = await request(BASE + '/ajax/image/list/' + readingId + '?mode=vertical', {
    Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: link,
  });
  var body = await res.json().catch(function () { return null; });
  var doc = parseHtml((body && body.html) || '');
  var images = all(doc, '.container-reader-chapter > .iv-card, .container-reader-chapter > div > img').map(function (card) {
    return imageOf(card, link) || imageOf(first(card, 'img'), link);
  }).filter(function (image) {
    // The first card is the site's own banner.
    return image && !/\/manganow\.jpg$/.test(image);
  });
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image, headers: { Referer: originOf(image), 'User-Agent': AGENT } };
  });
}
