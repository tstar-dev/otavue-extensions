// TCB Scans (the group's own reader at tcbonepiecechapters.com: One Piece, Jujutsu Kaisen, Chainsaw Man and more).
// Ported from Keiyoushi's TCB Scans (src/en/tcbscans in github.com/keiyoushi/extensions-source, Apache-2.0):
// the projects page, title pages with their chapter lists, and the reader's images.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file.
//
// The whole catalogue is one page (about 20 projects), so search filters it. Keiyoushi has no Latest; here it's the
// home page's "Latest Chapters", each matched to its project by name. Chapter names are "<Series> Chapter <n>" with
// the chapter's title on a second line; only the latest chapters have dates.
//
// @theme tcbscans
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

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href || /^data:/.test(href)) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function projects() {
  var doc = await page(BASE + '/projects');
  var seen = {};
  var items = [];
  all(doc, 'div.bg-card').forEach(function (card) {
    var link = first(card, 'a[href].text-white');
    var url = absolute(attr(link, 'href'), doc.url);
    var title = textOf(link);
    if (!/\/mangas\/\d+\//.test(url) || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: absolute(attr(first(card, 'img'), 'src'), doc.url) || null });
  });
  return items;
}

async function popular() {
  return { items: await projects(), hasNextPage: false };
}

function simple(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The home page's latest chapters, as their projects (newest first, once each). */
async function latest(options) {
  if (options && options.page > 1) return { items: [], hasNextPage: false };
  var list = await projects();
  var doc = await page(BASE + '/');
  var seen = {};
  var items = [];
  all(doc, 'div.bg-card').forEach(function (card) {
    var name = simple(textOf(first(card, 'a.text-white')).replace(/\s+(?:chapter|ch\.?)\s*[\d.]+.*$/i, ''));
    // The longest project name the chapter's series starts with ("Black Clover" vs "Black Clover Gaiden …").
    var match = list.filter(function (item) { var title = simple(item.title); return name === title || name.indexOf(title + ' ') === 0; })
      .sort(function (a, b) { return b.title.length - a.title.length; })[0];
    if (!match || seen[match.url]) return;
    seen[match.url] = true;
    items.push(match);
  });
  return { items: items, hasNextPage: false };
}

async function search(text) {
  var query = simple(text);
  var items = await projects();
  return { items: query ? items.filter(function (item) { return simple(item.title).indexOf(query) >= 0; }) : items, hasNextPage: false };
}

async function getFilters() {
  return [];
}

/* ── details ──────────────────────────────────────────────────────────── */

function titleUrl(url) {
  var match = /^https?:\/\/[^\/]+\/mangas\/(\d+)\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return BASE + '/mangas/' + match[1] + '/' + match[2];
}

/** Every chapter, one per number, oldest first: "Chapter 1196: The worthless love of …". */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'div.grid a[href*="/chapters/"]').forEach(function (link) {
    var url = absolute(attr(link, 'href'), doc.url);
    var heading = textOf(first(link, 'div.font-bold'));
    var match = /(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i.exec(heading);
    var number = match ? Number(match[1]) : numberOf(heading, url);
    if (!url || number === null || seen[number]) return;
    seen[number] = true;
    var subtitle = textOf(first(link, '.text-gray-500'));
    out.push({ url: url, title: (match ? 'Chapter ' + match[1] : heading) + (subtitle ? ': ' + subtitle : ''), number: number, date: null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await page(titleUrl(url));
  var info = first(doc, 'div.order-1');
  var heading = first(info, 'h1');
  if (!heading) throw new Error(SITE.name + ' no longer has this.');
  var chapters = chaptersOf(doc);
  var description = textOf(first(info, 'p'));
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  return {
    title: textOf(heading),
    cover: absolute(attr(first(info, 'img'), 'src'), doc.url) || null,
    description: description,
    status: null,
    genres: [],
    authors: [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(titleUrl(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var doc = await page(String(url).replace(/#.*$/, ''));
  var images = all(doc, 'picture img, .image-container img').map(function (img) { return absolute(attr(img, 'src'), doc.url); }).filter(Boolean);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) { return { url: image, headers: { 'User-Agent': AGENT } }; });
}
