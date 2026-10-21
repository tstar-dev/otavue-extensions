// MangaCatalog (a network of single-franchise reader sites: readonepiece.com, readsnk.com, readberserk.com, …).
// Ported from Keiyoushi's MangaCatalog (lib-multisrc/mangacatalog in github.com/keiyoushi/extensions-source,
// Apache-2.0): each site's fixed list of series, and the selectors for its three page layouts.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all required except where marked):
//   series        [[title, path, cover], …]: the site's series; the site has no list or search of its own
//   layout        "tailwind" (most sites, the default), "bootstrap" (readberserk.com, readopm.com) or
//                 "single" (one series on the home page, chapters as links: thetowerofgod.com)
//   chapterLinks  ("single" only) a selector for chapter links
//   pageImages    (optional) a selector for page images; "single" sites also need imageHosts
//   imageHosts    (optional) a pattern page images' links must match (Blogger, on thetowerofgod.com)
//   checkNewest   (optional) leave out newest chapters without pages: thetowerofgod.com posts a chapter's page
//                 before its images, and readsololeveling.org lists an announcement as a chapter
//
// These sites move between numbered hosts (ww12.readsnk.com → ww13.readsnk.com), so links on any of a site's
// hosts are read as links on the current one, and a saved title still opens after a move.
//
// @theme mangacatalog
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var LAYOUT = SITE.layout || 'tailwind';
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var PAGE_IMAGES = SITE.pageImages || 'img.js-page, img.pages__img';
var IMAGE_HOSTS = SITE.imageHosts ? new RegExp(SITE.imageHosts) : null;

// @include lib/html.js

/* ── links ────────────────────────────────────────────────────────────── */

/** "ww12.readsnk.com" and "readsnk.com" are one site. */
function familyOf(url) {
  var match = /^https?:\/\/([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase().replace(/^(?:www|w+\d+)\./, '') : '';
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

/** A link on any of the site's hosts, moved to the current one; '' for links elsewhere. */
function onSite(href, base) {
  var url = absolute(href, base);
  if (!url || familyOf(url) !== familyOf(BASE)) return '';
  return BASE + url.replace(/^https?:\/\/[^\/?#]+/i, '').replace(/[?#].*$/, '');
}

/* ── requests ─────────────────────────────────────────────────────────── */

async function page(url) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && familyOf(res.url) !== familyOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  return doc;
}

/* ── titles ───────────────────────────────────────────────────────────── */

var SERIES = (SITE.series || []).map(function (entry) {
  return { title: entry[0], url: onSite(entry[1]), cover: entry[2] ? absolute(entry[2]) : null };
});

function seriesOf(url) {
  var link = onSite(url);
  for (var i = 0; i < SERIES.length; i++) if (SERIES[i].url === link) return SERIES[i];
  return null;
}

function toItem(series) {
  return { title: series.title, url: series.url, cover: series.cover };
}

/* ── lists ────────────────────────────────────────────────────────────── */

// The site is one franchise, so its whole list is a single page.
async function popular() {
  return { items: SERIES.map(toItem), hasNextPage: false };
}

function folded(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
}

async function search(text) {
  var query = folded(text).trim();
  return { items: SERIES.filter(function (series) { return folded(series.title).indexOf(query) >= 0; }).map(toItem), hasNextPage: false };
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Chapter rows as { url, title, date }, newest first as the sites list them. */
function rowsOf(doc) {
  if (LAYOUT === 'bootstrap') {
    return all(doc, 'tbody > tr').map(function (row) {
      var cells = all(row, 'td');
      return { url: onSite(attr(first(row, 'a[href]'), 'href'), doc.url), title: textOf(cells[0]), date: dateOf(textOf(cells[1]), 'MMM d, yyyy') };
    });
  }
  if (LAYOUT === 'single') {
    return all(doc, SITE.chapterLinks).map(function (link) {
      return { url: onSite(attr(link, 'href'), doc.url), title: textOf(link), date: null };
    });
  }
  return all(doc, 'div.grid div.col-span-4').map(function (cell) {
    var link = first(cell, 'a[href]');
    var name = textOf(link);
    var subtitle = textOf(first(cell, 'div.text-xs'));
    return { url: onSite(attr(link, 'href'), doc.url), title: subtitle ? name + ' - ' + subtitle : name, date: null };
  });
}

/**
 * One chapter per number, oldest first. A series with no numbers at all (a guidebook, an art book) is
 * numbered in the site's order instead; otherwise an unnumbered entry is left out.
 */
function chaptersOf(doc) {
  var rows = rowsOf(doc).filter(function (row) { return row.url && row.title; }).reverse();
  var numbered = rows.some(function (row) { return numberOf(row.title, row.url) !== null; });
  var seen = {};
  var urls = {};
  var out = [];
  rows.forEach(function (row, index) {
    if (urls[row.url]) return;
    urls[row.url] = true;
    var number = numbered ? numberOf(row.title, row.url) : index + 1;
    if (number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: row.url, title: row.title, number: number, date: row.date });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

/** With `checkNewest`, newest chapters without any pages (not out yet, or not a chapter) are left out. */
async function withoutUnposted(chapters) {
  if (!SITE.checkNewest) return chapters;
  for (var tries = 0; tries < 3 && chapters.length; tries++) {
    var images = await imagesOf(chapters[chapters.length - 1].url);
    if (images.length) break;
    chapters = chapters.slice(0, -1);
  }
  return chapters;
}

function descriptionOf(doc) {
  if (LAYOUT === 'bootstrap') return all(doc, 'div.card-body p').filter(function (p) { return !first(p, 'p'); }).map(textOf).filter(Boolean).join('\n\n');
  // The home page has two: the site's own blurb, and the series' synopsis (the longer one).
  if (LAYOUT === 'single') {
    return all(doc, 'meta[property="og:description"]').map(function (meta) { return clean(attr(meta, 'content')); })
      .sort(function (a, b) { return b.length - a.length; })[0] || '';
  }
  var label = first(doc, 'div.bg-bg-secondary div.flex-col div:containsOwn(Description)');
  var text = label ? nextElement(label) : first(doc, 'div.bg-bg-secondary div.text-text-muted');
  return text ? rawText(text).split(/\n\s*\n/).map(clean).filter(Boolean).join('\n\n') || textOf(text) : '';
}

function titleOf(doc, series) {
  if (LAYOUT === 'bootstrap') return textOf(first(doc, 'h2 > span'));
  if (LAYOUT === 'single') return series ? series.title : SITE.name;
  return textOf(first(doc, 'div.container > h1'));
}

function coverOf(doc) {
  var img = LAYOUT === 'bootstrap' ? first(doc, '.card-img-right') : LAYOUT === 'single' ? null : first(doc, 'div.bg-bg-secondary div.flex > img');
  if (img) return absolute(attr(img, 'src'), doc.url) || null;
  var meta = attr(first(doc, 'meta[property="og:image"]'), 'content');
  return meta ? absolute(meta, doc.url) : null;
}

async function getDetail(url) {
  var series = seriesOf(url);
  var doc = await page(onSite(url) || url);
  var chapters = await withoutUnposted(chaptersOf(doc));
  var description = descriptionOf(doc);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  return {
    title: titleOf(doc, series) || (series && series.title) || SITE.name,
    cover: coverOf(doc) || (series && series.cover),
    description: description,
    chapters: chapters,
  };
}

async function getChapters(url) {
  return withoutUnposted(chaptersOf(await page(onSite(url) || url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** Each page once, in order: lazy images keep the real link in data-src, and <noscript> repeats them. */
async function imagesOf(url) {
  var doc = await page(onSite(url) || url);
  var seen = {};
  var out = [];
  all(doc, PAGE_IMAGES).forEach(function (img) {
    var src = attr(img, 'data-src').trim() || attr(img, 'src').trim();
    if (!src || /^data:/.test(src)) return;
    var image = absolute(src, doc.url);
    if (!image || seen[image] || (IMAGE_HOSTS && !IMAGE_HOSTS.test(image))) return;
    seen[image] = true;
    out.push(image);
  });
  return out;
}

async function getPages(url) {
  var images = await imagesOf(url);
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
