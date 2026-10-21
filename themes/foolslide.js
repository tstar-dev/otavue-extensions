// FoOlSlide (an older PHP reader still run by some scanlation groups: Death Toll Scans, Mangatellers, …).
// Ported from Keiyoushi's FoolSlide (lib-multisrc/foolslide in github.com/keiyoushi/extensions-source, Apache-2.0):
// its directory, latest and search pages, info labels, chapter dates, the adult-content form and the reader's pages.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   path        where the reader lives under the site ("/slide" for Menudo-Fansub and NIFTeam)
//   popular     "latest": the directory is empty, so Popular lists the series in the latest pages (Juin Jutsu)
//   search      "latest": the site's search answers nothing, so titles in the first latest pages are searched
//   skipBare    leave out chapter entries named with a bare number (Juin Jutsu lists volumes that way)
//
// Title and chapter pages are fetched with the site's "adult=true" form, which skips its content warning.
//
// @theme foolslide
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var READER = BASE + String(SITE.path || '').replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var FORM = 'application/x-www-form-urlencoded';

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function page(url, body) {
  var headers = { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: READER + '/' };
  if (body !== undefined) headers['Content-Type'] = FORM;
  var res = await fetch(url, { method: body !== undefined ? 'POST' : 'GET', headers: headers, body: body });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var text = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(text)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  var html = await res.text();
  var doc = parseHtml(html);
  doc.url = res.url || url;
  doc.html = html;
  return doc;
}

/** Title and chapter pages, past the adult-content warning. */
function adultPage(url) {
  return page(url, 'adult=true');
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || READER + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

/* ── lists ────────────────────────────────────────────────────────────── */

/** Series cards (`div.group` with a titled link to /series/…), each once. */
function itemsOf(doc, nextSelector) {
  var seen = {};
  var items = [];
  all(doc, 'div.group').forEach(function (group) {
    var link = all(group, 'a[title]').filter(function (a) { return /\/series\//.test(attr(a, 'href')); })[0];
    var url = link && absolute(attr(link, 'href'), doc.url).replace(/[?#].*$/, '');
    var title = textOf(link);
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    var cover = absolute(attr(first(group, 'img'), 'src'), doc.url).replace('/thumb_', '/');
    items.push({ title: title, url: url, cover: cover || null });
  });
  return { items: items, hasNextPage: Boolean(first(doc, nextSelector)) };
}

async function latestPage(pageNumber) {
  return itemsOf(await page(READER + '/latest/' + pageNumber + '/'), 'div.next a');
}

async function popular(options) {
  var pageNumber = (options && options.page) || 1;
  if (SITE.popular === 'latest') return latestPage(pageNumber);
  return itemsOf(await page(READER + '/directory/' + pageNumber + '/'), 'div.next');
}

// Where Popular is the latest list already, there's no separate Latest.
var latest = SITE.popular === 'latest' ? undefined : function (options) { return latestPage((options && options.page) || 1); };

async function search(text, pageNumber) {
  var query = String(text || '').trim();
  if ((pageNumber || 1) > 1) return { items: [], hasNextPage: false };
  if (SITE.search === 'latest') {
    var wanted = query.toLowerCase();
    var found = [];
    var seen = {};
    for (var n = 1; n <= 5; n++) {
      var listed = await latestPage(n);
      listed.items.forEach(function (item) {
        if (!seen[item.url] && item.title.toLowerCase().indexOf(wanted) >= 0) { seen[item.url] = true; found.push(item); }
      });
      if (!listed.hasNextPage) break;
    }
    return { items: found, hasNextPage: false };
  }
  var doc = await page(READER + '/search/', 'search=' + encodeURIComponent(query));
  return { items: itemsOf(doc, 'a:has(span.next)').items, hasNextPage: false };
}

/* ── details ──────────────────────────────────────────────────────────── */

/** `<b>Author</b>: Name` pairs in the info box, by lower-cased label. */
function infoOf(doc) {
  var out = {};
  all(doc, 'div.info b').forEach(function (b) {
    var next = null;
    var list = b.parent ? b.parent.children : [];
    var at = list.indexOf(b);
    if (at >= 0 && list[at + 1] && list[at + 1].text !== undefined) next = list[at + 1].text;
    var value = clean(String(next || '')).replace(/^:\s*/, '');
    if (value) out[textOf(b).toLowerCase()] = value;
  });
  return out;
}

function pick(info, words) {
  for (var key in info) {
    for (var i = 0; i < words.length; i++) if (key.indexOf(words[i]) >= 0) return info[key];
  }
  return '';
}

var TODAY = /^(today|oggi|hoy)\b/i;
var YESTERDAY = /^(yesterday|ieri|ayer)\b/i;

/** "by Death Toll Scans, 2020.01.11", "Ieri", "3 days ago", "11th January, 2021". */
function chapterDate(text) {
  var value = clean(text).replace(/^by\s.*?,\s*/i, '');
  var midnight = Math.floor(Date.now() / 864e5) * 864e5;
  if (TODAY.test(value)) return new Date(midnight).toISOString();
  if (YESTERDAY.test(value)) return new Date(midnight - 864e5).toISOString();
  var dotted = /(\d{4})\.(\d{2})\.(\d{2})/.exec(value);
  if (dotted) return dayIso(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]));
  return dateOf(value, 'd MMMM, yyyy');
}

/** "/read/<slug>/<lang>/<volume>/<chapter>/<sub>/" → chapter.sub. */
function numberFromUrl(url) {
  var match = /\/read\/[^\/]+\/[^\/]+\/\d+\/(\d+)(?:\/(\d+))?\/?(?:page\/\d+\/?)?$/.exec(url);
  if (!match) return null;
  return Number(match[1] + (match[2] && match[2] !== '0' ? '.' + match[2] : ''));
}

function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'div.group_comic div.element, div.group div.element, div.list div.element').reverse().forEach(function (row) {
    var link = first(row, 'a[title]');
    var url = absolute(attr(link, 'href'), doc.url);
    var name = textOf(link);
    if (!url || !name || hostOf(url) !== hostOf(BASE)) return;
    if (SITE.skipBare && /^\d+$/.test(name)) return;
    var number = numberFromUrl(url);
    if (number === null) number = numberOf(name, url);
    if (number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: url, title: name, number: number, date: chapterDate(textOf(first(row, 'div.meta_r'))) });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await adultPage(url);
  var info = infoOf(doc);
  var chapters = chaptersOf(doc);
  var description = pick(info, ['synopsis', 'description', 'trama', 'sinopsis']);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var people = [pick(info, ['author', 'autore', 'autor']), pick(info, ['artist', 'artista'])].filter(Boolean);
  var title = textOf(first(doc, 'h1.title')) || clean(rawText(first(doc, 'title'))).split(' :: ')[0];
  return {
    title: title,
    cover: absolute(attr(first(doc, 'div.thumbnail img, table.thumb img'), 'src'), doc.url).replace('/thumb_', '/') || null,
    description: description,
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await adultPage(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var doc = await adultPage(url);
  var match = /var pages\s*=\s*(\[[\s\S]*?\]);/.exec(doc.html);
  var pages = [];
  try { pages = match ? JSON.parse(match[1]) : []; } catch (e) { pages = []; }
  var images = pages.map(function (one) { return absolute(one && one.url, doc.url); }).filter(Boolean);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image, headers: { Referer: READER + '/', 'User-Agent': AGENT } };
  });
}
