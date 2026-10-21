// MangaThemesia (the WordPress theme formerly "WP Manga Stream" / "WP Manga Reader"), used by many scanlation groups.
// Ported from Keiyoushi's MangaThemesia (lib-multisrc/mangathemesia in github.com/keiyoushi/extensions-source,
// Apache-2.0): its list URLs and filters, selectors, status words, locked-chapter markers and page reader.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   mangaPath     where titles live ("manga")            dateFormat  e.g. "MMMM d, yyyy" (the default)
//   randomSlug    the site adds a changing number to title links ("/manga/7395-name/"); kept out of ids
//   adult         keep titles with an 18+ label (false)   selectors   overrides for SELECTORS below
//
// @theme mangathemesia
// @version 1.0.1
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var MANGA_PATH = '/' + String(SITE.mangaPath || 'manga').replace(/^\/+|\/+$/g, '');
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };
var RANDOM_SLUG = /^\d+-/;

/** "a:contains(x), b:contains(x)" for each word, like Keiyoushi's `selector()`. */
function each(pattern, words) {
  return words.map(function (word) { return pattern.split('%s').join(word); }).join(', ');
}

var SELECTORS = {
  // Novels share some sites' lists; Otavue reads them as manga, so they're left out.
  item: '.utao .uta .imgu, .listupd .bs .bsx:not(:has(.novelabel)), .listo .bs .bsx:not(:has(.novelabel))',
  next: 'div.pagination .next, div.hpage .r',
  details: 'div.bigcontent, div.animefull, div.main-info, div.postbody',
  title: '.entry-title, .ts-breadcrumb li:last-child span',
  author: each('.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span', ['Author', 'Mangaka']),
  artist: each('.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span', ['Artist']),
  description: '.desc, .entry-content[itemprop=description]',
  alt: '.alternative, .wd-full:contains(alt) span, .alter, .seriestualt, .infotable tr:contains(Alternative) td:last-child',
  genre: 'div.gnr a, .mgen a, .seriestugenre a',
  type: each('.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .tsinfo .imptdt:contains(%s) a, .fmed b:contains(%s)+span', ['Type']),
  status: each('.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span', ['Status']),
  cover: '.infomanga > div[itemprop=image] img, .thumb img',
  chapter: 'div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)',
  chapterName: '.lch a, .chapternum',
  chapterDate: '.chapterdate',
  locked: 'a[data-bs-target="#lockedChapterModal"], a[data-coin], .locked-badge, .text-gold, i.fa-lock, .fa-lock',
  pages: 'div#readerarea img',
  genreList: 'ul.genrez li',
  randomList: 'div#content div.soralist ul li a.series, .listupd .bs .bsx a',
};
(function () {
  var overrides = SITE.selectors || {};
  for (var key in overrides) SELECTORS[key] = overrides[key];
})();

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function headers(extra) {
  var out = { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: BASE + '/' };
  for (var key in extra || {}) out[key] = extra[key];
  return out;
}

async function request(url, allow) {
  var res = await fetch(url, { headers: headers() });
  if (res.ok || (allow && allow.indexOf(res.status) >= 0)) return res;
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
  }
  throw new Error(SITE.name + ' answered ' + res.status + '.');
}

async function page(url, allow) {
  var res = await request(url, allow);
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  doc.status = res.status;
  return doc;
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : '';
}

/* ── titles ───────────────────────────────────────────────────────────── */

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

function slugOf(url) {
  var match = /\/([^\/?#]+)\/?(?:[?#].*)?$/.exec(url);
  return match ? match[1] : '';
}

/** The title's link without query or fragment, and without the changing number on `randomSlug` sites. */
function titleUrl(href) {
  var url = absolute(href).replace(/[?#].*$/, '');
  if (SITE.randomSlug) url = BASE + MANGA_PATH + '/' + slugOf(url).replace(RANDOM_SLUG, '') + '/';
  return url && byteLength(url) <= MAX_URL_BYTES ? url : '';
}

function imageOf(img, base) {
  if (!img) return null;
  var lazy = ['data-lazy-src', 'data-src', 'data-cfsrc'];
  for (var i = 0; i < lazy.length; i++) {
    var value = attr(img, lazy[i]).trim();
    if (value) return absolute(value, base) || null;
  }
  var src = attr(img, 'src').trim();
  if (!src || /^data:/.test(src)) return null;
  return absolute(src, base) || null;
}

/** A card's 18+ label (some themes print "18+" or "Adult" on the cover). */
function isAdultCard(block) {
  return Boolean(first(block, '.adult, .label-adult, .hot-adult, span.colored:contains(18+)'));
}

function itemsOf(doc) {
  var items = [];
  var seen = {};
  all(doc, SELECTORS.item).forEach(function (block) {
    var link = block.tag === 'a' ? block : first(block, 'a');
    if (!link) return;
    var url = titleUrl(attr(link, 'href'));
    var title = clean(attr(link, 'title')) || textOf(first(block, '.tt, .bigor .tt, h3 a')) || textOf(link);
    if (!url || !title || seen[url]) return;
    if (!SITE.adult && isAdultCard(block)) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: imageOf(first(block, 'img')), coverHeaders: COVER_HEADERS });
  });
  return { items: items, hasNextPage: Boolean(first(doc, SELECTORS.next)) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var ORDERS = [['', 'Default'], ['title', 'A–Z'], ['titlereverse', 'Z–A'], ['update', 'Latest update'], ['latest', 'Latest added'], ['popular', 'Popular']];
var STATUSES = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['dropped', 'Dropped']];
var TYPES = [['', 'All'], ['Manga', 'Manga'], ['Manhwa', 'Manhwa'], ['Manhua', 'Manhua'], ['Comic', 'Comic']];

/** The theme's list page: `/manga/?title=…&page=N&order=…&status=…&type=…&genre[]=…`. */
async function listPage(pageNumber, query, filters) {
  filters = filters || {};
  var params = [];
  if (query) params.push('title=' + encodeURIComponent(query));
  params.push('page=' + (pageNumber || 1));
  ['order', 'status', 'type'].forEach(function (key) {
    if (filters[key]) params.push(key + '=' + encodeURIComponent(filters[key]));
  });
  [].concat(filters.genres || []).filter(Boolean).forEach(function (genre) { params.push('genre%5B%5D=' + encodeURIComponent(genre)); });
  return itemsOf(await page(BASE + MANGA_PATH + '/?' + params.join('&')));
}

async function popular(options) {
  return listPage((options && options.page) || 1, '', { order: 'popular' });
}

async function latest(options) {
  return listPage((options && options.page) || 1, '', { order: 'update' });
}

async function search(query, pageNumber, options) {
  // WordPress search misses curly quotes the site itself prints ("It’s"), so they go back to straight ones.
  query = String(query || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
  var filters = (options && options.filters) || {};
  var found = await listPage(pageNumber || 1, query, filters);
  // Some sites store the curly quote instead; searching the words around it finds those.
  if (found.items.length === 0 && /['"]/.test(query)) found = await listPage(pageNumber || 1, query.replace(/['"]/g, ' ').replace(/\s+/g, ' '), filters);
  return found;
}

var genreCache = null;

/** The genre checkboxes on the site's list page (`ul.genrez`). */
async function genresOf() {
  if (genreCache) return genreCache;
  var doc = await page(BASE + MANGA_PATH + '/');
  genreCache = all(doc, SELECTORS.genreList).map(function (li) {
    var input = first(li, 'input[type=checkbox]');
    return { value: attr(input, 'value'), label: textOf(first(li, 'label')) };
  }).filter(function (genre) { return genre.value && genre.label; });
  return genreCache;
}

async function getFilters() {
  var genres = await genresOf().catch(function () { return []; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [
    { type: 'select', key: 'order', name: 'Order by', options: options(ORDERS), default: '' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
  ];
  if (genres.length) out.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

var STATUS_WORDS = [
  ['ongoing', /ongoing|on going|new season|mass released|publishing|updating/i],
  ['completed', /complete|finished|one-shot/i],
  ['cancelled', /cancel|dropped|discontinued/i],
  ['hiatus', /hiatus|on hold|season end/i],
  ['upcoming', /upcoming|coming soon/i],
];

function statusOf(text) {
  for (var i = 0; i < STATUS_WORDS.length; i++) if (STATUS_WORDS[i][1].test(text || '')) return STATUS_WORDS[i][0];
  return null;
}

function isPlaceholder(text) {
  return !text || /^(?:-|n\/a|unknown|updating)$/i.test(text);
}

function unique(values) {
  var seen = {};
  return values.filter(function (value) {
    var key = value.toLowerCase();
    if (!value || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function capitalised(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

var slugCache = null;

/** On `randomSlug` sites: the title's current link, from the full title list. */
async function currentLink(url) {
  if (!slugCache) {
    slugCache = {};
    var doc = await page(BASE + MANGA_PATH + '/list-mode/', [404]);
    if (doc.status === 404) doc = await page(BASE + MANGA_PATH + '/');
    all(doc, SELECTORS.randomList).forEach(function (link) {
      var href = absolute(attr(link, 'href'));
      var slug = slugOf(href);
      if (slug) slugCache[slug.replace(RANDOM_SLUG, '')] = href;
    });
  }
  return slugCache[slugOf(url).replace(RANDOM_SLUG, '')] || null;
}

/** The title page. On `randomSlug` sites the stored link may have lost its number, so a 404 looks it up. */
async function titlePage(url) {
  url = absolute(url);
  if (!SITE.randomSlug) return page(url);
  var doc = await page(url, [404]);
  if (doc.status !== 404) return doc;
  var current = await currentLink(url);
  if (!current) throw new Error(SITE.name + ' no longer has this.');
  return page(current);
}

async function getDetail(url) {
  var doc = await titlePage(url);
  var box = first(doc, SELECTORS.details) || doc;
  var title = textOf(first(box, SELECTORS.title));
  if (!title) throw new Error('That isn’t a ' + SITE.name + ' title page.');
  var descriptionBox = first(box, SELECTORS.description);
  var paragraphs = all(descriptionBox, 'p').map(textOf).filter(Boolean);
  var description = paragraphs.length ? paragraphs.join('\n\n') : textOf(descriptionBox);
  var altBox = first(box, SELECTORS.alt);
  var alt = ownText(altBox) || textOf(altBox);
  if (alt && !isPlaceholder(alt)) description = (description ? description + '\n\n' : '') + 'Also known as: ' + alt;
  var type = ownText(first(box, SELECTORS.type)) || textOf(first(box, SELECTORS.type));
  var people = [first(box, SELECTORS.author), first(box, SELECTORS.artist)]
    .map(function (el) { return ownText(el) || textOf(el); })
    .filter(function (name) { return !isPlaceholder(name); });
  var chapters = chaptersOf(doc);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  return {
    title: title,
    cover: imageOf(first(box, SELECTORS.cover), doc.url),
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(textOf(first(box, SELECTORS.status))),
    genres: unique(all(box, SELECTORS.genre).map(textOf).concat(type && !isPlaceholder(type) ? [type] : []).map(capitalised)),
    authors: unique(people),
    chapters: chapters,
  };
}

/* ── chapters ─────────────────────────────────────────────────────────── */

/** Locked (coin, "early access") chapters can't be read without an account, so they're left out. */
function isLocked(li, link) {
  if (!link || !attr(link, 'href') || attr(link, 'href') === '#') return true;
  return /🔒/.test(attr(li, 'data-num')) || matches(link, SELECTORS.locked) || Boolean(first(li, SELECTORS.locked));
}

/** One chapter per number, oldest first (Otavue ids chapters by number). */
function chaptersOf(doc) {
  var entries = [];
  all(doc, SELECTORS.chapter).forEach(function (li) {
    var link = first(li, 'a');
    if (isLocked(li, link)) return;
    var url = absolute(attr(link, 'href'), doc.url).replace(/#.*$/, '');
    // Early-access chapters often link out (Patreon, Ko-fi); only the site's own chapters can be read.
    if (hostOf(url) !== hostOf(BASE)) return;
    var name = textOf(first(li, SELECTORS.chapterName)) || textOf(link);
    var number = parseFloat(attr(li, 'data-num'));
    if (!(number >= 0)) number = numberOf(name, url);
    entries.push({ url: url, title: name || null, number: number, date: dateOf(textOf(first(li, SELECTORS.chapterDate)), SITE.dateFormat) });
  });
  var seen = {};
  var out = [];
  entries.reverse().forEach(function (entry) {
    if (entry.number === null || isNaN(entry.number) || seen[entry.number]) return;
    seen[entry.number] = true;
    out.push(entry);
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getChapters(url) {
  return chaptersOf(await titlePage(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** `ts_reader.run({ … "images": [...] })`, inline or as a base64 data: script. */
function readerImages(doc) {
  var scripts = all(doc, 'script').map(function (script) {
    var src = attr(script, 'src');
    if (/^data:text\/javascript;base64,/.test(src)) {
      try { return atob(src.slice(src.indexOf(',') + 1)); } catch (e) { return ''; }
    }
    return rawText(script);
  });
  for (var i = 0; i < scripts.length; i++) {
    var match = /["']?(?:images|imageUrls)["']?\s*[:=]\s*(\[[^\]]*\])/.exec(scripts[i]);
    if (!match) continue;
    try {
      return JSON.parse(match[1]).map(function (image) { return absolute(image); }).filter(Boolean);
    } catch (e) { /* not JSON; keep looking */ }
  }
  return [];
}

async function getPages(url) {
  url = absolute(url);
  var doc = await page(url);
  if (hostOf(doc.url) !== hostOf(BASE)) throw new Error('This chapter is only on ' + hostOf(doc.url) + ', not ' + SITE.name + '.');
  var pageHeaders = { Referer: BASE + '/', 'User-Agent': AGENT };
  var images = all(doc, SELECTORS.pages).map(function (img) { return imageOf(img, url); }).filter(Boolean);
  if (images.length === 0) images = readerImages(doc);
  var seen = {};
  return images.filter(function (image) {
    if (!/^https:\/\//.test(image) || seen[image]) return false;
    seen[image] = true;
    return true;
  }).map(function (image) { return { url: image, headers: pageHeaders }; });
}
