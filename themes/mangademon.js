// Manga Demon (demonicscans.org).
// Ported from Keiyoushi's Manga Demon (src/en/mangademon in github.com/keiyoushi/extensions-source, Apache-2.0):
// advanced.php for Popular and filters (sort, status, genres), lastupdates.php for Latest, search.php, the title
// page's details and chapter list, and the reader's images.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file.
//
// Title links are kept exactly as the site writes them; some encode an apostrophe twice ("Barbarian%2527s-…"), and
// the site answers either way. Image and cover addresses have raw spaces, which are encoded. Chapter links
// (chaptered.php?manga=6&chapter=200) redirect to the reader; its first image is often an ad (/img/…).
//
// @theme mangademon
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

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

/** An absolute https link, with raw spaces and the like encoded (new URL does that). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href || /^data:/.test(href)) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

/* ── lists ────────────────────────────────────────────────────────────── */

function hasNext(doc) {
  return all(doc, 'div.pagination > ul > a > li').some(function (li) { return /^Next$/i.test(textOf(li)); });
}

function titleUrl(href, base) {
  var url = absolute(href, base);
  return /\/manga\/[^\/?#]+/.test(url) ? url.replace(/[?#].*$/, '') : '';
}

function advanced(doc) {
  var seen = {};
  var items = [];
  all(doc, 'div#advanced-content > div.advanced-element').forEach(function (card) {
    var link = first(card, 'a');
    var url = titleUrl(attr(link, 'href'), doc.url);
    // The heading is cut short ("Barbarian's Adven..."); the link's title attribute isn't.
    var title = clean(attr(link, 'title')) || ownText(first(card, 'h1')) || textOf(first(card, 'h1'));
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: absolute(attr(first(card, 'img'), 'src'), doc.url) || null });
  });
  return { items: items, hasNextPage: hasNext(doc) };
}

function advancedUrl(params, pageNumber) {
  var parts = ['list=' + (pageNumber || 1)];
  params.forEach(function (pair) { parts.push(pair[0] + '=' + encodeURIComponent(pair[1])); });
  return BASE + '/advanced.php?' + parts.join('&');
}

async function popular(options) {
  return advanced(await page(advancedUrl([['status', 'all'], ['orderby', 'VIEWS DESC']], (options && options.page) || 1)));
}

async function latest(options) {
  var doc = await page(BASE + '/lastupdates.php?list=' + ((options && options.page) || 1));
  var seen = {};
  var items = [];
  all(doc, 'div#updates-container > div.updates-element').forEach(function (card) {
    // Keiyoushi leaves out cards with the "toffee" badge (paid early chapters).
    if (first(card, '.toffee-badge')) return;
    var link = first(card, 'div.updates-element-info a');
    var url = titleUrl(attr(link, 'href'), doc.url);
    // The link text is cut short ("…World..."); its title attribute isn't.
    var title = clean(attr(link, 'title')) || ownText(link);
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: absolute(attr(first(card, 'div.thumb img'), 'src'), doc.url) || null });
  });
  return { items: items, hasNextPage: hasNext(doc) };
}

var SORTS = [['VIEWS DESC', 'Top views'], ['NAME ASC', 'A to Z']];
var STATUSES = [['all', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed']];
var GENRES = [
  ['1', 'Action'], ['2', 'Adventure'], ['3', 'Comedy'], ['34', 'Cooking'], ['25', 'Doujinshi'], ['4', 'Drama'], ['19', 'Ecchi'],
  ['5', 'Fantasy'], ['30', 'Gender Bender'], ['10', 'Harem'], ['28', 'Historical'], ['8', 'Horror'], ['33', 'Isekai'], ['31', 'Josei'],
  ['6', 'Martial Arts'], ['22', 'Mature'], ['32', 'Mecha'], ['15', 'Mystery'], ['26', 'One Shot'], ['11', 'Psychological'],
  ['12', 'Romance'], ['13', 'School Life'], ['16', 'Sci-fi'], ['17', 'Seinen'], ['14', 'Shoujo'], ['23', 'Shoujo Ai'], ['7', 'Shounen'],
  ['29', 'Shounen Ai'], ['21', 'Slice of Life'], ['27', 'Smut'], ['20', 'Sports'], ['9', 'Supernatural'], ['18', 'Tragedy'], ['24', 'Webtoons'],
];

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  if (query) {
    // One page of quick results.
    if (pageNumber > 1) return { items: [], hasNextPage: false };
    var doc = await page(BASE + '/search.php?manga=' + encodeURIComponent(query));
    var seen = {};
    var items = [];
    all(doc, 'a[href]').forEach(function (link) {
      var url = titleUrl(attr(link, 'href'), doc.url);
      var title = textOf(first(link, 'div.seach-right > div'));
      if (!url || !title || seen[url]) return;
      seen[url] = true;
      items.push({ title: title, url: url, cover: absolute(attr(first(link, 'img'), 'src'), doc.url) || null });
    });
    return { items: items, hasNextPage: false };
  }
  var filters = (options && options.filters) || {};
  var params = [['status', filters.status || 'all'], ['orderby', filters.sort || 'VIEWS DESC']];
  (Array.isArray(filters.genres) ? filters.genres : filters.genres ? [filters.genres] : []).forEach(function (id) { params.push(['genre[]', id]); });
  return advanced(await page(advancedUrl(params, pageNumber || 1)));
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  return [
    { type: 'select', key: 'sort', name: 'Sort (filters are ignored when searching by text)', options: options(SORTS), default: 'VIEWS DESC' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: 'all' },
    { type: 'multi', key: 'genres', name: 'Genres', options: options(GENRES), default: [] },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

function pageUrl(url) {
  var match = /^https?:\/\/[^\/]+(\/manga\/[^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return BASE + match[1];
}

/** A stats row's value ("Author" → "Chugong,H-goon,KI Soryeong"). */
function stat(info, label) {
  var row = all(info, 'div#manga-info-stats > div').filter(function (div) {
    var cells = all(div, 'li');
    return cells.length > 1 && textOf(cells[0]).toLowerCase().indexOf(label.toLowerCase()) === 0;
  })[0];
  return row ? textOf(all(row, 'li')[1]) : '';
}

/** Every chapter, one per number (from the link's `chapter=`), oldest first. */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'div#chapters-list a.chplinks').forEach(function (link) {
    var url = absolute(attr(link, 'href'), doc.url);
    var match = /[?&]chapter=([\d.]+)/.exec(url);
    var name = ownText(link);
    var number = match ? Number(match[1]) : numberOf(name, url);
    if (!url || number === null || !isFinite(number) || seen[number]) return;
    seen[number] = true;
    out.push({ url: url, title: name || 'Chapter ' + number, number: number, date: dateOf(textOf(first(link, 'span')), 'yyyy-MM-dd') });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await page(pageUrl(url));
  var info = first(doc, 'div#manga-info-container');
  var heading = first(info, 'h1.big-fat-titles');
  if (!heading) throw new Error(SITE.name + ' no longer has this.');
  var chapters = chaptersOf(doc);
  var description = textOf(first(info, 'div#manga-info-rightColumn > div > div.white-font'));
  var also = stat(info, 'Alternatives').split(';').map(function (name) { return name.trim(); }).filter(Boolean);
  if (also.length) description += (description ? '\n\n' : '') + 'Also known as: ' + also.join(', ');
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = all(info, 'div.genres-list > li').map(textOf).filter(Boolean);
  var author = stat(info, 'Author');
  var status = stat(info, 'Status');
  return {
    title: ownText(heading) || textOf(heading),
    cover: absolute(attr(first(info, 'div#manga-page img'), 'src'), doc.url) || null,
    description: description,
    status: /ongoing/i.test(status) ? 'ongoing' : /completed/i.test(status) ? 'completed' : null,
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    authors: author && !/updating/i.test(author) ? author.split(/\s*,\s*/).filter(Boolean) : [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(pageUrl(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var doc = await page(String(url).replace(/#.*$/, ''));
  var images = all(doc, 'div > img.imgholder').map(function (img) { return attr(img, 'src'); })
    // The site's own ads are local (/img/free_ads.jpg); pages come from image hosts.
    .filter(function (src) { return /^https?:\/\//i.test(String(src).trim()); })
    .map(function (src) { return absolute(src, doc.url); }).filter(Boolean);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) { return { url: image, headers: { 'User-Agent': AGENT } }; });
}
