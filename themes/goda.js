// GoDa (an Astro reader that re-hosts manga, manhwa and manhua; Goda at manhuascans.org).
// Ported from Keiyoushi's GoDa (lib-multisrc/goda in github.com/keiyoushi/extensions-source, Apache-2.0):
// its list, search and genre pages, the title page's layout, the chapters endpoint (/manga/get) and the pages
// endpoint (/chapter/getcontent).
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file, one copy per site.
//
// Cloudflare turns away the chapters endpoint unless the site is the Referer, and the image host wants it too.
// Chapter links carry `#<series id>/<chapter id>` for the pages endpoint. A few slugs are too long for Otavue's
// 150-byte ids: those are cut short at a word and carry the full slug's length after `#`; search finds the rest.
//
// @theme goda
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var IMAGE_HEADERS = { Referer: BASE + '/' };
var MAX_URL_BYTES = 150;

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Referer: BASE + '/' } });
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

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/* ── titles ───────────────────────────────────────────────────────────── */

/** The title's link, cut short at a word (with the full slug's length after `#`) when it's over 150 bytes. */
function titleUrl(slug) {
  var url = BASE + '/manga/' + slug;
  if (byteLength(url) <= MAX_URL_BYTES) return url;
  var mark = '#' + slug.length;
  var short = slug.slice(0, MAX_URL_BYTES - byteLength(BASE + '/manga/' + mark));
  if (short.lastIndexOf('-') > 0) short = short.slice(0, short.lastIndexOf('-'));
  return BASE + '/manga/' + short + mark;
}

/** `{ slug, length }` from a title or chapter link; `length` only when the slug was cut short. */
function partsOf(url) {
  var match = /\/manga\/([^\/?#]+)(?:[^#]*)(?:#(\d+)$)?/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return { slug: decodeURIComponent(match[1]), length: match[2] ? Number(match[2]) : null };
}

/** The full slug of a cut-short link: search by its first words, matched on the start and the length. */
async function fullSlug(parts) {
  if (!parts.length) return parts.slug;
  var words = parts.slug.split('-').filter(Boolean);
  var tries = [words.slice(0, 4).join(' '), words.slice(0, 2).join(' ')];
  for (var i = 0; i < tries.length; i++) {
    var found = itemsOf(await page(BASE + '/s/' + encodeURIComponent(tries[i]) + '?page=1')).slugs.filter(function (slug) {
      return slug.length === parts.length && slug.indexOf(parts.slug) === 0;
    })[0];
    if (found) return found;
  }
  throw new Error(SITE.name + ' no longer has this.');
}

/** Cards from the list, genre and search pages. */
function itemsOf(doc) {
  var seen = {};
  var items = [];
  var slugs = [];
  all(doc, '.cardlist .pb-2 a').forEach(function (link) {
    var match = /\/manga\/([^\/?#]+)\/?$/.exec(absolute(attr(link, 'href'), doc.url));
    var title = textOf(first(link, 'h3'));
    if (!match || !title || seen[match[1]]) return;
    seen[match[1]] = true;
    var src = attr(first(link, 'img'), 'src');
    // Some covers go through an image proxy: "...?url=<the cover>".
    var proxied = /[?&]url=([^&]+)/.exec(src);
    slugs.push(match[1]);
    items.push({ title: title, url: titleUrl(match[1]), cover: absolute(proxied ? decodeURIComponent(proxied[1]) : src, doc.url) || null, coverHeaders: IMAGE_HEADERS });
  });
  // An empty page past the end still shows the NEXT button.
  return { items: items, slugs: slugs, hasNextPage: items.length > 0 && Boolean(first(doc, 'a[aria-label=NEXT] button')) };
}

function listOf(doc) {
  var out = itemsOf(doc);
  return { items: out.items, hasNextPage: out.hasNextPage };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function popular(options) {
  return listOf(await page(BASE + '/hots/page/' + ((options && options.page) || 1)));
}

async function latest(options) {
  return listOf(await page(BASE + '/newss/page/' + ((options && options.page) || 1)));
}

var GENRES = [
  ['/manga-genre/manhwa', 'Manhwa'], ['/manga-genre/manga', 'Manga'], ['/manga-genre/manhua', 'Manhua'],
  ['/manga-tag/action', 'Action'], ['/manga-tag/adaptation', 'Adaptation'], ['/manga-tag/adventure', 'Adventure'],
  ['/manga-tag/comedy', 'Comedy'], ['/manga-tag/crossdressing', 'Crossdressing'], ['/manga-tag/delinquents', 'Delinquents'],
  ['/manga-tag/demons', 'Demons'], ['/manga-tag/drama', 'Drama'], ['/manga-tag/ecchi', 'Ecchi'], ['/manga-tag/fantasy', 'Fantasy'],
  ['/manga-tag/fullcolor', 'Full color'], ['/manga-tag/genius-mc', 'Genius MC'], ['/manga-tag/gyaru', 'Gyaru'], ['/manga-tag/harem', 'Harem'],
  ['/manga-tag/isekai', 'Isekai'], ['/manga-tag/longstrip', 'Long strip'], ['/manga-tag/magic', 'Magic'],
  ['/manga-tag/martial-arts', 'Martial arts'], ['/manga-tag/monsters', 'Monsters'], ['/manga-tag/psychological', 'Psychological'],
  ['/manga-tag/reincarnation', 'Reincarnation'], ['/manga-tag/romance', 'Romance'], ['/manga-tag/samurai', 'Samurai'],
  ['/manga-tag/schoollife', 'School life'], ['/manga-tag/shounen', 'Shounen'], ['/manga-tag/sliceoflife', 'Slice of life'],
  ['/manga-tag/supernatural', 'Supernatural'], ['/manga-tag/timetravel', 'Time travel'], ['/manga-tag/webcomic', 'Web comic'],
];

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  pageNumber = pageNumber || 1;
  if (query) return listOf(await page(BASE + '/s/' + encodeURIComponent(query) + '?page=' + pageNumber));
  var genre = ((options && options.filters) || {}).genre;
  var known = GENRES.some(function (pair) { return pair[0] === genre; });
  return listOf(await page(BASE + (known ? genre : '/hots') + '/page/' + pageNumber));
}

async function getFilters() {
  return [{
    type: 'select', key: 'genre', name: 'Genre (ignored when searching by text)',
    options: [{ value: '', label: 'All' }].concat(GENRES.map(function (pair) { return { value: pair[0], label: pair[1] }; })),
    default: '',
  }];
}

/* ── details ──────────────────────────────────────────────────────────── */

function statusOf(text) {
  if (/ongoing/i.test(text)) return 'ongoing';
  if (/complete/i.test(text)) return 'completed';
  if (/hiatus/i.test(text)) return 'hiatus';
  if (/cancel|dropped/i.test(text)) return 'cancelled';
  return null;
}

/** The links in the info row that starts with `label` ("Author:", "Genres:"). */
function rowLinks(info, label) {
  var row = all(info, 'div').filter(function (el) { return textOf(first(el, 'span.font-medium')) === label; })[0];
  return row ? all(row, 'a').map(textOf).filter(Boolean) : [];
}

/** "Sep 12" (this year, or last year when that's still ahead), or any date `dateOf` reads. */
function chapterDate(text, now) {
  now = now || Date.now();
  var date = dateOf(text, null, now);
  if (date) return date;
  var match = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/i.exec(clean(text));
  if (!match || monthOf(match[1]) < 0) return null;
  var year = new Date(now).getUTCFullYear();
  date = dayIso(year, monthOf(match[1]), Number(match[2]));
  return date && Date.parse(date) > now + 864e5 ? dayIso(year - 1, monthOf(match[1]), Number(match[2])) : date;
}

/** Every chapter, one per number, oldest first. */
async function chaptersOf(seriesId) {
  var doc = await page(BASE + '/manga/get?mid=' + encodeURIComponent(seriesId) + '&mode=all');
  var seen = {};
  var out = [];
  all(doc, '.chapteritem a').forEach(function (link) {
    var href = absolute(attr(link, 'href'), BASE + '/');
    var chapterId = attr(link, 'data-cs');
    var name = clean(attr(link, 'data-ct')) || textOf(first(link, '.chaptertitle'));
    var number = numberOf(name, href);
    if (!href || !chapterId || number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: href + '#' + seriesId + '/' + chapterId, title: name, number: number, date: chapterDate(textOf(first(link, 'span.italic'))) });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function titlePage(url) {
  var slug = await fullSlug(partsOf(url));
  var doc = await page(BASE + '/manga/' + slug);
  var seriesId = attr(first(doc, '#mangachapters'), 'data-mid');
  if (!seriesId) throw new Error(SITE.name + ' no longer has this.');
  return { doc: doc, seriesId: seriesId };
}

async function getDetail(url) {
  var found = await titlePage(url);
  var doc = found.doc;
  var info = first(doc, '#info') || doc;
  var heading = first(info, 'h1');
  var chapters = await chaptersOf(found.seriesId);
  var description = textOf(first(info, 'p.text-medium'));
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = rowLinks(info, 'Genres:').concat(all(info, 'a[href^="/manga-tag/"]').map(function (link) { return textOf(link).replace(/^#/, ''); }));
  return {
    title: ownText(heading),
    cover: absolute(attr(first(doc, 'main img.object-cover'), 'src'), doc.url) || null,
    coverHeaders: IMAGE_HEADERS,
    description: description,
    status: statusOf(textOf(first(heading, 'span'))),
    genres: genres.filter(function (name, i) { return name && genres.indexOf(name) === i; }),
    authors: rowLinks(info, 'Author:'),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf((await titlePage(url)).seriesId);
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var ids = /#([^\/#]+)\/([^\/#]+)$/.exec(String(url));
  if (!ids) {
    // A link without the ids: the reader page names them.
    var reader = first(await page(String(url).replace(/#.*$/, '')), '[data-ms][data-cs]');
    if (!reader) throw new Error('This chapter has no pages on ' + SITE.name + '.');
    ids = [null, attr(reader, 'data-ms'), attr(reader, 'data-cs')];
  }
  var doc = await page(BASE + '/chapter/getcontent?m=' + encodeURIComponent(ids[1]) + '&c=' + encodeURIComponent(ids[2]));
  var images = all(doc, '#chapcontent > div > img').map(function (img) {
    return absolute(attr(img, 'data-src') || attr(img, 'src'), doc.url);
  }).filter(function (image) {
    // The first image is often the site's "read it at ..." banner.
    return image && !/\/offer\//.test(image);
  });
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
