// YiiManga (a manhwa reader theme: ManhwaBuddy, ManhwaOnline, ToonGod and others).
// Ported from Keiyoushi's Yiimanga (lib-multisrc/yiimanga in github.com/keiyoushi/extensions-source, Apache-2.0):
// its list, search and genre URLs, selectors for its three page layouts, and chapter dates.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (mangaPath is required):
//   mangaPath     where titles live ("manhwa", "manga", "webtoon", "read")
//   searchParam   the search page's query parameter ("s", the default, or "q")
//   popularPath   a catalog the site sorts with ?order=views; without it, Popular is the latest list
//   popular       "home": Popular is the home page's featured row (ManhwaBuddy)
//   genrePath     how genre pages are numbered: "page" (/genre/<slug>/page/2/, the default) or "bare" (/genre/<slug>/2/)
//
// @theme yiimanga
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var MANGA_PATH = String(SITE.mangaPath || 'manga').replace(/^\/+|\/+$/g, '');
var SEARCH_PARAM = SITE.searchParam || 's';
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function page(url) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  return doc;
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/* ── lists ────────────────────────────────────────────────────────────── */

function titleUrl(href, base) {
  var url = absolute(href, base).replace(/[?#].*$/, '');
  return url && hostOf(url) === hostOf(BASE) && byteLength(url) <= MAX_URL_BYTES ? url : '';
}

function imageOf(img, base) {
  if (!img) return null;
  var src = attr(img, 'data-src').trim() || attr(img, 'src').trim();
  return src && !/^data:/.test(src) ? absolute(src, base) || null : null;
}

function itemsOf(doc) {
  var seen = {};
  var items = [];
  all(doc, '.latest-list .latest-item, .list .list-item').forEach(function (card) {
    var link = first(card, '.latest-right a:has(h3, h4), .item-title a');
    var url = titleUrl(attr(link, 'href'), doc.url);
    var title = textOf(link);
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: imageOf(first(card, '.latest-left img, .item-img img'), doc.url), coverHeaders: COVER_HEADERS });
  });
  return { items: items, hasNextPage: Boolean(first(doc, '#pagination li.next a')) };
}

function listUrl(segments, pageNumber) {
  return BASE + '/' + segments.concat(['page', String(pageNumber || 1)]).join('/') + '/';
}

async function latestList(pageNumber) {
  return itemsOf(await page(listUrl([], pageNumber)));
}

async function popular(options) {
  var pageNumber = (options && options.page) || 1;
  if (SITE.popular === 'home') {
    var doc = await page(BASE + '/');
    var items = all(doc, '.item-move').map(function (card) {
      var link = first(card, '.name a');
      return { title: textOf(link), url: titleUrl(attr(link, 'href'), doc.url), cover: imageOf(first(card, 'img'), doc.url), coverHeaders: COVER_HEADERS };
    }).filter(function (item) { return item.title && item.url; });
    return { items: items, hasNextPage: false };
  }
  if (!SITE.popularPath) return latestList(pageNumber);
  return itemsOf(await page(listUrl([SITE.popularPath], pageNumber) + '?order=views'));
}

// Sites without a sorted catalog only have the latest list, which Popular already is.
var latest = SITE.popularPath || SITE.popular ? function (options) { return latestList((options && options.page) || 1); } : undefined;

function genreUrl(slug, pageNumber) {
  if (!pageNumber || pageNumber === 1) return BASE + '/genre/' + slug + '/';
  if (SITE.genrePath === 'bare') return BASE + '/genre/' + slug + '/' + pageNumber + '/';
  return listUrl(['genre', slug], pageNumber);
}

// The sites' search matches every word in full: an apostrophe makes it fail (500), and words it doesn't index
// (two letters or fewer, MySQL's stopwords) never match, so "Raised By Villains" finds nothing.
var STOPWORDS = ['about', 'are', 'com', 'for', 'from', 'how', 'that', 'the', 'this', 'was', 'what', 'when', 'where', 'who', 'will', 'with', 'und', 'www'];

function searchWords(text) {
  return String(text || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(function (word) {
    return word.length >= 3 && STOPWORDS.indexOf(word.toLowerCase()) < 0;
  });
}

async function search(text, pageNumber, options) {
  var words = searchWords(text);
  var genre = options && options.filters && options.filters.genre;
  var searchPage = function (query) { return page(BASE + '/search/?' + SEARCH_PARAM + '=' + encodeURIComponent(query) + '&page=' + (pageNumber || 1)); };
  if (words.length) {
    var found = itemsOf(await searchPage(words.join(' ')));
    // A title with a word the site spells differently ("Manager’s") still turns up under its longest word.
    if (found.items.length === 0 && words.length > 1 && (pageNumber || 1) === 1) {
      var longest = words.slice().sort(function (a, b) { return b.length - a.length; })[0];
      found = itemsOf(await searchPage(longest));
    }
    return found;
  }
  if (String(text || '').trim()) return { items: [], hasNextPage: false };
  if (genre) return itemsOf(await page(genreUrl(encodeURIComponent(genre), pageNumber)));
  return latestList(pageNumber || 1);
}

/** The genres linked from the home page's menu; sites that link none get no filter. */
async function getFilters() {
  var doc = await page(BASE + '/').catch(function () { return null; });
  var seen = {};
  var genres = [];
  all(doc, '.genre-list a, a.item-nav[href*="/genre/"], a.item-nav-mb[href*="/genre/"]').forEach(function (link) {
    var match = /\/genre\/([^\/?#]+)/.exec(attr(link, 'href'));
    var name = textOf(link);
    if (!match || !name || seen[match[1]]) return;
    seen[match[1]] = true;
    genres.push({ value: decodeURIComponent(match[1]), label: name });
  });
  if (genres.length === 0) return [];
  genres.sort(function (a, b) { return a.label.localeCompare(b.label); });
  return [{ type: 'select', key: 'genre', name: 'Genre (ignored when searching by text)', options: [{ value: '', label: 'All' }].concat(genres), default: '' }];
}

/* ── details ──────────────────────────────────────────────────────────── */

/** The value next to a label ("Author(s)", "Status:", "Genres -") in any of the theme's info lists. */
function info(doc, labels) {
  var headings = all(doc, '.main-info-list li > h5, .post-content_item .summary-heading > h5, .info-item > span.sh');
  for (var i = 0; i < headings.length; i++) {
    var label = textOf(headings[i]).replace(/\s*[:\-]$/, '');
    if (labels.indexOf(label) < 0) continue;
    var row = headings[i].parent;
    if (row && /summary-heading/.test(attr(row, 'class'))) row = row.parent;
    var value = (row ? row.children : []).filter(function (child) {
      return isElement(child) && child.tag !== 'h5' && !/summary-heading|\bsh\b/.test(attr(child, 'class'));
    })[0];
    if (value) return value;
  }
  return null;
}

function namesOf(el) {
  if (!el) return [];
  var links = all(el, 'a');
  var names = links.length ? links.map(ownText) : textOf(el).split(',');
  return names.map(function (name) { return clean(name).replace(/,$/, ''); }).filter(Boolean);
}

function statusOf(text) {
  var value = String(text || '').trim().toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  return null;
}

/** "06 Oct 2026", "12 Oct 26", or just "Oct 26" (the 1st). */
function chapterDate(text) {
  var match = /(?:(\d{1,2})\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{4}|\d{2})\b/.exec(String(text || ''));
  if (!match) return dateOf(text);
  var year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return dayIso(year, monthOf(match[2]), match[1] ? Number(match[1]) : 1);
}

/** One chapter per number, oldest first. */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'ul.chapter-list li, ul.row-content-chapter li, .list-items li.item').reverse().forEach(function (row) {
    var link = first(row, 'a[href]');
    var url = absolute(attr(link, 'href'), doc.url);
    if (!url || hostOf(url) !== hostOf(BASE)) return;
    var name = textOf(first(row, '.chapter-name')) || textOf(first(row, '.item a > span')) || textOf(link);
    var number = numberOf(name, url);
    if (number === null || seen[number]) return;
    seen[number] = true;
    var dateEl = first(row, '.ct-update, .chapter-time') || all(row, '.item a > span')[1];
    out.push({ url: url, title: name, number: number, date: chapterDate(textOf(dateEl)) });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

function descriptionOf(doc) {
  var block = first(doc, '.short-desc-content, .dsct, .description-summary');
  var parts = block ? all(block, 'p, li').map(textOf).filter(Boolean) : [];
  var text = parts.length ? parts.join('\n\n') : textOf(block);
  var alt = textOf(info(doc, ['Alternative'])) || textOf(first(doc, '.main-info-list li > h4, .manga-detail .info h6'));
  if (alt) text = (text ? text + '\n\n' : '') + 'Also known as: ' + alt;
  return text;
}

async function getDetail(url) {
  var doc = await page(url);
  var chapters = chaptersOf(doc);
  var description = descriptionOf(doc);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var people = namesOf(info(doc, ['Author(s)', 'Author', 'Autores'])).concat(namesOf(info(doc, ['Artist(s)', 'Artist', 'Artistas'])));
  return {
    title: textOf(first(doc, 'h1.main-info-title, .post-title h1, .manga-detail .info h1')),
    cover: imageOf(first(doc, 'img.img-cover, .summary_image img, .manga-detail .poster img'), doc.url),
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(textOf(info(doc, ['Status', 'Estado']) || first(doc, '.manga-detail .info p.type'))),
    genres: namesOf(info(doc, ['Genres', 'Genre(s)', 'Géneros'])),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i && !/^updating$/i.test(name); }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var doc = await page(url);
  var seen = {};
  var images = [];
  all(doc, '.reading-content img, .read-content img').forEach(function (img) {
    var image = imageOf(img, doc.url);
    if (!image || seen[image]) return;
    seen[image] = true;
    images.push(image);
  });
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
