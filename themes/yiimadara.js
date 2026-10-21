// YiiMadara (Yii2 sites that copy Madara's markup; Manga Dass and MangaDNA).
// Ported from Keiyoushi's YiiMadara (lib-multisrc/yiimadara in github.com/keiyoushi/extensions-source, Apache-2.0):
// its list, search, genre and category pages, `orderby` sorts, the title page's info rows, the chapter list and
// the reader's images, and hiding untranslated raws.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site. Config:
//   mangaPath      title links' first path segment (default "manga")
//   directoryPath  the catalogue, sorted with ?orderby= (default "manga")
//   completedPath  the completed category (default "completed"; "" for none)
//   rawPath        the raws category, if the site has one ("raw-manhwa")
//   catalogPaging  "page" when the catalogue pages as /<directoryPath>/page/<n> (other lists stay /<path>/<n>)
//   showRaws       keep untranslated raws (titles ending in "raw") in lists; English sites hide them by default
//
// Search answers 500 to a plain apostrophe, so it's sent as ’.
//
// @theme yiimadara
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var MANGA_PATH = SITE.mangaPath || 'manga';
var DIRECTORY_PATH = SITE.directoryPath || 'manga';
var COMPLETED_PATH = SITE.completedPath === undefined ? 'completed' : SITE.completedPath;
var RAW_PATH = SITE.rawPath || '';
var CATALOG_PAGING = SITE.catalogPaging === 'page';
var SHOW_RAWS = SITE.showRaws === undefined ? SITE.lang !== 'en' : Boolean(SITE.showRaws);

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function page(url) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
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
  if (!href || /^data:/.test(href)) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function imageOf(img, base) {
  return absolute(attr(img, 'data-src') || attr(img, 'src'), base);
}

/* ── lists ────────────────────────────────────────────────────────────── */

function isRaw(item) {
  return /-raw\/?$/.test(item.url) || /\sraw$/i.test(item.title);
}

function itemsOf(doc, rawListing) {
  var seen = {};
  var items = [];
  all(doc, 'div.page-item, div.page-item-detail, div.home-item, div.manga-item').forEach(function (card) {
    var link = first(card, 'h3 a');
    var url = absolute(attr(link, 'href'), doc.url).replace(/[?#].*$/, '');
    var title = textOf(link);
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    var item = { title: title, url: url, cover: imageOf(first(card, 'img'), doc.url) || null };
    if (rawListing || SHOW_RAWS || !isRaw(item)) items.push(item);
  });
  return { items: items, hasNextPage: Boolean(first(doc, '#blog-pager li.next a')) };
}

function listUrl(path, pageNumber, sort) {
  var paged = CATALOG_PAGING && path === DIRECTORY_PATH ? '/page/' : '/';
  return BASE + '/' + path + paged + (pageNumber || 1) + (sort ? '?orderby=' + encodeURIComponent(sort) : '');
}

async function popular(options) {
  return itemsOf(await page(listUrl(DIRECTORY_PATH, (options && options.page) || 1, 'trending')), DIRECTORY_PATH === RAW_PATH);
}

async function latest(options) {
  return itemsOf(await page(listUrl(DIRECTORY_PATH, (options && options.page) || 1, '')), DIRECTORY_PATH === RAW_PATH);
}

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  if (query) return itemsOf(await page(BASE + '/search?q=' + encodeURIComponent(query.replace(/'/g, '’')) + '&page=' + (pageNumber || 1)), false);
  var filters = (options && options.filters) || {};
  var path = filters.genre || filters.category || DIRECTORY_PATH;
  // Only the site's own paths.
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/i.test(path)) path = DIRECTORY_PATH;
  return itemsOf(await page(listUrl(path, pageNumber || 1, filters.sort || '')), path === RAW_PATH);
}

var SORTS = [['', 'Latest updates'], ['trending', 'Trending'], ['latest', 'Newest'], ['rating', 'Rating'], ['alphabet', 'A-Z']];

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var genres = [];
  try {
    var doc = await page(BASE + '/');
    var seen = {};
    all(doc, 'a[href*="genre/"]').forEach(function (link) {
      var path = new URL(absolute(attr(link, 'href'), doc.url)).pathname.replace(/^\/+|\/+$/g, '');
      var name = textOf(link);
      if (!name || seen[path]) return;
      seen[path] = true;
      genres.push([path, name]);
    });
    genres.sort(function (a, b) { return a[1].localeCompare(b[1]); });
  } catch (e) { genres = []; }
  var categories = [['', 'All']];
  if (COMPLETED_PATH) categories.push([COMPLETED_PATH, 'Completed']);
  if (RAW_PATH) categories.push([RAW_PATH, 'Raw']);
  var filters = [];
  if (genres.length) filters.push({ type: 'select', key: 'genre', name: 'Genre (ignored when searching by text)', options: options([['', 'All']].concat(genres)), default: '' });
  if (categories.length > 1) filters.push({ type: 'select', key: 'category', name: 'Category (Genre comes first)', options: options(categories), default: '' });
  filters.push({ type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: '' });
  return filters;
}

/* ── details ──────────────────────────────────────────────────────────── */

function titleUrl(url) {
  var match = new RegExp('^https?://[^/]+/' + MANGA_PATH + '/([^/?#]+)').exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return BASE + '/' + MANGA_PATH + '/' + match[1];
}

/** An info row's value: a `.summary-heading`/`.summary-content` pair, a `<b>` label, or a `.minfo` line. */
function info(doc, label) {
  var starts = function (text) { return text.toLowerCase().indexOf(label.toLowerCase()) === 0; };
  var item = all(doc, '.post-content_item').filter(function (el) {
    var heading = first(el, '.summary-heading') || first(el, 'b');
    return heading && starts(textOf(heading));
  })[0];
  if (item) return first(item, '.summary-content') || item;
  return all(doc, '.minfo').filter(function (el) { return starts(ownText(el)); })[0] || null;
}

function valueOf(node) {
  var text = textOf(node);
  return text && !/^(updating|n\/a)$/i.test(text) ? text : '';
}

function namesOf(node) {
  if (!node) return [];
  var links = all(node, 'a').map(textOf);
  var names = links.length ? links : valueOf(node).split(/\s*,\s*/);
  return names.filter(function (name) { return name && !/^updating$/i.test(name); });
}

function statusOf(text) {
  if (/ongoing/i.test(text)) return 'ongoing';
  if (/completed/i.test(text)) return 'completed';
  return null;
}

/** The chapters on the title page, one per number, oldest first. */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'ul.row-content-chapter li').forEach(function (row) {
    var link = first(row, 'a');
    var url = absolute(attr(link, 'href'), doc.url);
    var name = textOf(link);
    var number = numberOf(name, url);
    if (!url || number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: url, title: name, number: number, date: dateOf(textOf(first(row, '.chapter-time')), 'd MMM yyyy') || dateOf(textOf(first(row, '.chapter-time')), 'd MMM yy') });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await page(titleUrl(url));
  var heading = first(doc, '.post-title h1');
  if (!heading) throw new Error(SITE.name + ' no longer has this.');
  var chapters = chaptersOf(doc);
  var block = first(doc, '.dsct, .ss-manga, .post-content_item .entry-content');
  var paragraphs = block ? all(block, 'p').map(textOf).filter(Boolean) : [];
  var description = paragraphs.length ? paragraphs.join('\n\n') : textOf(block);
  var also = valueOf(info(doc, 'Alternative'));
  if (also) description += (description ? '\n\n' : '') + 'Also known as: ' + also;
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = namesOf(info(doc, 'Genre'));
  var type = valueOf(info(doc, 'Type'));
  if (type && genres.indexOf(type) < 0) genres.push(type);
  var authors = namesOf(info(doc, 'Author')).concat(namesOf(info(doc, 'Artist')));
  return {
    // Some sites put an "18+" badge inside the heading.
    title: ownText(heading) || textOf(heading),
    cover: imageOf(first(doc, '.summary_image img'), doc.url) || null,
    description: description,
    status: statusOf(textOf(info(doc, 'Status'))),
    genres: genres,
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(titleUrl(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/**
 * The reader's image links, read from the raw HTML: its tags quote `alt` with ' around titles that contain one
 * ("alt='A Returner's Magic…'"), which throws an HTML parser off every other image.
 */
function readerImages(html, base) {
  var start = html.search(/class=["'][^"']*\bread-content\b/);
  if (start < 0) return [];
  var block = html.slice(start, html.indexOf('</div>', start) < 0 ? undefined : html.indexOf('</div>', start));
  return block.split(/<img\b/i).slice(1).map(function (tag) {
    var match = /\bdata-src\s*=\s*["']([^"'\s>]+)/i.exec(tag) || /\bsrc\s*=\s*["']([^"'\s>]+)/i.exec(tag);
    return match ? absolute(decodeEntities(match[1]), base) : '';
  }).filter(Boolean);
}

async function getPages(url) {
  url = String(url).replace(/#.*$/, '');
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) throw new Error(SITE.name + ' answered ' + res.status + '.');
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  var images = readerImages(await res.text(), res.url || url);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) { return { url: image, headers: { Referer: BASE + '/', 'User-Agent': AGENT } }; });
}
