// Hyakuro Translations (the group's own site, hyakuro.net, over its Strapi API at /backend/api).
// Ported from Keiyoushi's Hyakuro Translations (src/en/hyakuro in github.com/keiyoushi/extensions-source,
// Apache-2.0): /mangas with Strapi's sort, pagination and filters (title, status, oneshots, categories), chapters as
// a list on each title, chapter names, and pages from /backend/uploads.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file.
//
// Keiyoushi reads a chapter's pages by loading every chapter's pages of the title (2.5 MB for a long one); this asks
// Strapi for the one chapter instead (a nested filter on Chapters, about 3 KB). Chapter links carry the chapter's
// id after `#`. Pages come unordered and are sorted by the page number in their file names. A few slugs are too long
// for Otavue's 150-byte ids: those are cut at a word with the full slug's length after `#`, and found again with
// Strapi's $startsWith filter.
//
// @theme hyakuro
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = BASE + '/backend/api';
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/* ── requests ─────────────────────────────────────────────────────────── */

/** `pairs` of [key, value]; Strapi's bracketed keys are encoded as they are. */
function query(pairs) {
  return pairs.filter(function (pair) { return pair[1] !== undefined && pair[1] !== null && pair[1] !== ''; })
    .map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

async function mangas(pairs) {
  var res = await fetch(API + '/mangas?' + query(pairs), { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' } });
  var text = await res.text();
  if (!res.ok) {
    if (/cf-chl|Just a moment/i.test(text)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  try { return JSON.parse(text); } catch (e) { throw new Error(SITE.name + ' answered with something other than its API.'); }
}

function upload(path) {
  return path ? BASE + '/backend' + String(path).replace(/^\/?/, '/') : null;
}

/* ── titles ───────────────────────────────────────────────────────────── */

function statusOf(text) {
  if (text === 'Ongoing') return 'ongoing';
  if (text === 'Completed') return 'completed';
  if (text === 'Dropped') return 'cancelled';
  return null;
}

function coverOf(attributes) {
  var cover = attributes.Cover && attributes.Cover.data && attributes.Cover.data.attributes;
  return cover ? upload(cover.url) : null;
}

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/** The title's link, cut short at a word (with the full slug's length after `#`) when it's over 150 bytes. */
function titleUrl(slug) {
  var url = BASE + '/manga/' + slug;
  if (byteLength(url) <= MAX_URL_BYTES) return url;
  var mark = '#' + slug.length;
  var short = slug.slice(0, MAX_URL_BYTES - byteLength(BASE + '/manga/' + mark));
  if (short.lastIndexOf('-') > 0) short = short.slice(0, short.lastIndexOf('-'));
  return BASE + '/manga/' + short + mark;
}

function toItem(entry) {
  var a = entry.attributes || {};
  return { title: String(a.Title || '').trim(), url: titleUrl(a.slug), cover: coverOf(a), status: statusOf(a.Status) };
}

function listOf(body) {
  var items = (body.data || []).filter(function (entry) { return entry.attributes && entry.attributes.slug; }).map(toItem);
  var pages = (body.meta && body.meta.pagination) || {};
  return { items: items, hasNextPage: Number(pages.page) < Number(pages.pageCount) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function popular(options) {
  return listOf(await mangas([['populate', 'Cover'], ['sort', 'Title:asc'], ['pagination[page]', (options && options.page) || 1]]));
}

async function latest(options) {
  return listOf(await mangas([['populate', 'Cover'], ['sort', 'updatedAt:desc'], ['pagination[page]', (options && options.page) || 1]]));
}

var STATUSES = [['', 'All'], ['Ongoing', 'Ongoing'], ['Completed', 'Completed'], ['Dropped', 'Dropped'], ['Oneshot', 'Oneshot']];
var CATEGORIES = ['Action', 'Adult', 'Adventure', 'Comedy', 'Doujinshi', 'Drama', 'Ecchi', 'Fantasy', 'Gender Bender', 'Harem', 'Hentai',
  'Historical', 'Horror', 'Josei', 'Lolicon', 'Martial Arts', 'Mature', 'Mecha', 'Mystery', 'Psychological', 'Romance', 'School Life',
  'Sci-fi', 'Seinen', 'Shotacon', 'Shoujo', 'Shoujo Ai', 'Shounen', 'Shounen Ai', 'Slice of Life', 'Smut', 'Sports', 'Supernatural',
  'Tragedy', 'Webtoon', 'Yaoi', 'Yuri'];

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  var pairs = [['populate', 'Cover'], ['sort', 'updatedAt:desc'], ['pagination[page]', pageNumber || 1], ['filters[Title][$containsi]', String(text || '').trim()]];
  if (filters.status === 'Oneshot') pairs.push(['filters[Oneshot][$eq]', 'true']);
  else if (filters.status) pairs.push(['filters[Status][$eq]', filters.status]);
  (Array.isArray(filters.categories) ? filters.categories : filters.categories ? [filters.categories] : []).forEach(function (name, i) {
    pairs.push(['filters[$and][' + (i + 1) + '][Categories][$containsi]', name]);
  });
  return listOf(await mangas(pairs));
}

async function getFilters() {
  return [
    { type: 'select', key: 'status', name: 'Status', options: STATUSES.map(function (pair) { return { value: pair[0], label: pair[1] }; }), default: '' },
    { type: 'multi', key: 'categories', name: 'Categories (all of them)', options: CATEGORIES.map(function (name) { return { value: name, label: name }; }), default: [] },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

/** `{ slug, length }` from a title link; `length` only when the slug was cut short. */
function slugOf(url) {
  var match = /\/manga\/([^\/?#]+)(?:[^#]*#(\d+)$)?/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return { slug: decodeURIComponent(match[1]), length: match[2] ? Number(match[2]) : null };
}

/** A title's attributes, by its slug (or a cut-short one: the slug starting so, of the full length). */
async function title(parts, chapterPopulate) {
  var key = parts.length ? 'filters[slug][$startsWith]' : 'filters[slug][$eq]';
  var pairs = [[key, parts.slug], ['populate[Cover]', 'true']].concat(chapterPopulate || [['populate[Chapters]', 'true']]);
  var entry = ((await mangas(pairs)).data || []).filter(function (row) {
    return row.attributes && (!parts.length || String(row.attributes.slug).length === parts.length);
  })[0];
  if (!entry) throw new Error(SITE.name + ' no longer has this.');
  return entry.attributes;
}

function numberText(number) {
  return String(Number(number));
}

function dayOf(text) {
  if (!text) return null;
  if (/^\d{4}-\d\d-\d\d$/.test(text)) return text + 'T00:00:00.000Z';
  var time = Date.parse(text);
  return isFinite(time) ? new Date(time).toISOString() : null;
}

/** Every chapter, one per number, oldest first: "Chapter 6", "Oneshot - <title>". */
function chaptersOf(slug, attributes) {
  var seen = {};
  var out = [];
  (attributes.Chapters || []).forEach(function (chapter) {
    var number = Number(chapter.Chapter);
    if (!isFinite(number) || seen[number] || !chapter.id) return;
    seen[number] = true;
    var name = chapter.Title ? String(chapter.Title).trim() : '';
    var label = attributes.Oneshot ? 'Oneshot' : 'Chapter ' + numberText(number);
    out.push({
      url: BASE + '/manga/' + slug + '/read/' + numberText(number) + '/1#' + chapter.id,
      title: label + (name ? ' - ' + name : ''),
      number: number,
      date: dayOf(chapter.TranslatedOn || attributes.publishedAt),
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var a = await title(slugOf(url));
  var chapters = chaptersOf(a.slug, a);
  var description = String(a.Synopsis || '').trim();
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = (a.Categories || []).concat([a.Longstrip ? 'Longstrip' : null, a.Oneshot ? 'Oneshot' : null]).filter(Boolean);
  var authors = [a.Author, a.Artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(a.Title || '').trim(),
    cover: coverOf(a),
    description: description,
    status: statusOf(a.Status),
    genres: genres,
    authors: authors.filter(function (name, i) { return authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  var a = await title(slugOf(url));
  return chaptersOf(a.slug, a);
}

/* ── pages ────────────────────────────────────────────────────────────── */

function pageNumber(path) {
  var match = /Page[_ -]?(\d+)/i.exec(String(path));
  return match ? Number(match[1]) : null;
}

async function getPages(url) {
  // Chapter links carry the full slug (their length isn't limited).
  var slug = decodeURIComponent((/\/manga\/([^\/?#]+)/.exec(String(url)) || [])[1] || '');
  if (!slug) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var id = (/#(\d+)$/.exec(String(url)) || [])[1];
  var number = (/\/read\/([\d.]+)/.exec(String(url)) || [])[1];
  var filter = id ? ['populate[Chapters][filters][id][$eq]', id] : ['populate[Chapters][filters][Chapter][$eq]', number];
  var a = await title({ slug: slug, length: null }, [filter, ['populate[Chapters][populate][Pages][fields][0]', 'url'],
    ['populate[Chapters][populate][Pages][fields][1]', 'width'], ['populate[Chapters][populate][Pages][fields][2]', 'height']]);
  var chapter = (a.Chapters || [])[0];
  var rows = (chapter && chapter.Pages && chapter.Pages.data) || [];
  var pages = rows.map(function (row) { return row.attributes || {}; }).filter(function (page) { return page.url; })
    .sort(function (x, y) {
      var a1 = pageNumber(x.url);
      var b1 = pageNumber(y.url);
      return a1 !== null && b1 !== null && a1 !== b1 ? a1 - b1 : String(x.url).localeCompare(String(y.url));
    })
    .map(function (page) {
      var out = { url: upload(page.url), headers: { 'User-Agent': AGENT } };
      if (page.width && page.height) { out.width = page.width; out.height = page.height; }
      return out;
    });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages;
}
