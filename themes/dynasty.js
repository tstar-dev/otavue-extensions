// Dynasty Scans (dynasty-scans.com, the yuri reader and archive).
// Ported from Keiyoushi's Dynasty Scans (src/en/dynasty in github.com/keiyoushi/extensions-source, Apache-2.0):
// the home page's most popular chapters, /chapters/added.json for Latest, /search with its sort, type, tag, author,
// scanlator and pairing filters (names to ids through /tags/suggest), the series, anthology, doujin and issue JSON
// with their chapter lists, single chapters as their own titles, page images from /chapters/<permalink>.json, and the
// cover map and tag list it ships (lib/dynasty-data.js).
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file.
//
// Titles are /series/, /anthologies/, /doujins/ and /issues/ collections, or a single /chapters/ release that
// belongs to no series (most doujins). A chapter link "<series>_ch12" stands for its series.
// Numbers: a series' chapters from their names ("Chapter 183: Family Call"); entries without one (magazine
// editions, extras) just after the chapter before them. Anthology, doujin and issue collections hold separate
// works without numbers, so they're numbered in release order. Collections list 25 works a page; up to 40 pages are
// read.
//
// @theme dynasty
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COLLECTIONS = { Series: 'series', Anthology: 'anthologies', Doujin: 'doujins', Issue: 'issues' };
var DIRECTORIES = ['series', 'anthologies', 'doujins', 'issues', 'chapters'];
var MAX_PAGES = 40;

// @include lib/html.js
// @include lib/dynasty-data.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url, options) {
  options = options || {};
  var headers = { 'User-Agent': AGENT, Referer: BASE + '/', Accept: options.accept || 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  var res = await fetch(url, { method: options.body ? 'POST' : 'GET', headers: headers, body: options.body });
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

async function json(path, options) {
  var res = await request(BASE + path, options);
  try { return JSON.parse(await res.text()); } catch (e) { throw new Error(SITE.name + ' answered with something other than its data.'); }
}

async function page(path) {
  var res = await request(BASE + path, { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' });
  var doc = parseHtml(await res.text());
  doc.url = res.url || BASE + path;
  return doc;
}

/* ── titles ───────────────────────────────────────────────────────────── */

/** "<series>_ch12" or "<series>_volume_2" → the series; anything else stays a single chapter. */
function resolve(directory, permalink) {
  if (directory !== 'chapters') return { directory: directory, permalink: permalink };
  var match = /^(.*?)_(ch[0-9_]+|volume_[0-9_\w]+)$/.exec(permalink);
  return match ? { directory: 'series', permalink: match[1] } : { directory: directory, permalink: permalink };
}

function coverPath(file) {
  if (!file) return null;
  var path = String(file).replace(/^https?:\/\/[^\/]+/, '').replace(/^\/+/, '');
  return BASE + '/' + (path.indexOf('system/') === 0 ? path : 'system/tag_contents_covers/000/' + path);
}

/** A collection's cover from the shipped map (single chapters have none there). */
function knownCover(directory, permalink) {
  var map = DYNASTY_COVERS[directory];
  return map && map[permalink] ? coverPath(map[permalink]) : null;
}

function nameOf(permalink) {
  return permalink.split('_').filter(Boolean).map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); }).join(' ');
}

function item(directory, permalink, title, cover) {
  return { title: title, url: BASE + '/' + directory + '/' + permalink, cover: cover || knownCover(directory, permalink) };
}

function addOnce(list, entry) {
  if (!list.some(function (other) { return other.url === entry.url; })) list.push(entry);
}

/* ── lists ────────────────────────────────────────────────────────────── */

/** The home page's "Most Popular of Past 7 Days" chapters, as their series where they have one. */
async function popular(options) {
  if (options && options.page > 1) return { items: [], hasNextPage: false };
  var doc = await page('/');
  var heading = all(doc, 'h4').filter(function (h) { return /Most Popular of Past 7 Days/i.test(textOf(h)); })[0];
  var items = [];
  if (heading) {
    for (var el = nextElement(heading); el; el = nextElement(el)) {
      if (!matches(el, 'ul.cover-list')) continue;
      all(el, 'a.thumbnail').forEach(function (link) {
        var match = /\/chapters\/([^\/?#]+)/.exec(attr(link, 'href'));
        if (!match) return;
        var where = resolve('chapters', match[1]);
        var caption = textOf(first(link, '.caption b'));
        // "Guilty Library ch03" → "Guilty Library": the caption keeps the punctuation a permalink loses.
        var title = where.directory === 'chapters' ? caption : caption.replace(/\s+(?:ch|vol(?:ume)?)\.?\s*[\d.]+.*$/i, '') || nameOf(where.permalink);
        var cover = where.directory === 'chapters' ? absoluteUrl(attr(first(link, 'img'), 'src')) : null;
        addOnce(items, item(where.directory, where.permalink, title, cover || knownCover(where.directory, where.permalink) || absoluteUrl(attr(first(link, 'img'), 'src'))));
      });
    }
  }
  return { items: items, hasNextPage: false };
}

function absoluteUrl(href) {
  href = String(href || '').trim();
  if (!href) return null;
  try { return new URL(href, BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return null; }
}

/** Newly added chapters: each one's series, anthology or issue, or the chapter itself when it stands alone. */
async function latest(options) {
  var pageNumber = (options && options.page) || 1;
  var body = await json('/chapters/added.json?page=' + (pageNumber - 1));
  var items = [];
  (body.chapters || []).forEach(function (chapter) {
    var tags = chapter.tags || [];
    var owner = ['Series', 'Anthology', 'Issue'].map(function (type) { return tags.filter(function (tag) { return tag.type === type; })[0]; }).filter(Boolean)[0];
    if (owner) addOnce(items, item(COLLECTIONS[owner.type], owner.permalink, owner.name));
    else if (chapter.permalink) addOnce(items, item('chapters', chapter.permalink, chapter.title, null));
  });
  return { items: items, hasNextPage: Number(body.current_page) < Number(body.total_pages) };
}

var SORTS = [['', 'Smart (best match, or newest without words)'], ['best', 'Best match'], ['name', 'Alphabetical'], ['created_at', 'Date added'], ['released_on', 'Release date']];
var TYPES = [['Series', 'Series'], ['Chapter', 'Chapters'], ['Anthology', 'Anthologies'], ['Doujin', 'Doujins'], ['Issue', 'Issues']];

function listOf(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean).map(String);
}

/** A tag's id from its exact name, through the site's suggestions. */
async function tagId(name, type) {
  var wanted = name.trim().toLowerCase();
  var rows = await json('/tags/suggest', { body: 'query=' + encodeURIComponent(name.trim()) });
  var hit = (Array.isArray(rows) ? rows : []).filter(function (row) { return row.type === type && String(row.name).trim().toLowerCase() === wanted; })[0];
  if (!hit) throw new Error('No ' + type.toLowerCase() + ' on ' + SITE.name + ' is called "' + name.trim() + '".');
  return hit.id;
}

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  var filters = (options && options.filters) || {};
  var types = listOf(filters.types);
  if (!types.length) types = TYPES.map(function (type) { return type[0]; });
  var params = ['q=' + encodeURIComponent(query)];
  var sort = filters.sort === 'best' ? '' : filters.sort || (query ? '' : 'released_on');
  params.push('sort=' + encodeURIComponent(sort));
  types.forEach(function (type) { params.push('classes%5B%5D=' + encodeURIComponent(type)); });
  // Only the chosen types. (Keiyoushi adds chapters to find more series, but chapter rows don't link their series,
  // so an author's series came back as a page of their extras.)
  listOf(filters.tags).forEach(function (id) { params.push('with%5B%5D=' + encodeURIComponent(id)); });
  listOf(filters.notTags).forEach(function (id) { params.push('without%5B%5D=' + encodeURIComponent(id)); });
  var named = [['author', 'Author'], ['scanlator', 'Scanlator'], ['pairing', 'Pairing']];
  for (var i = 0; i < named.length; i++) {
    var names = String(filters[named[i][0]] || '').split(',').filter(function (name) { return name.trim(); });
    for (var j = 0; j < names.length; j++) params.push('with%5B%5D=' + (await tagId(names[j], named[i][1])));
  }
  if (pageNumber > 1) params.push('page=' + pageNumber);
  var doc = await page('/search?' + params.join('&'));
  var found = [];
  all(doc, '.chapter-list a.name, .chapter-list .doujin_tags a').forEach(function (link) {
    var match = /^\/(series|anthologies|chapters|doujins|issues)\/([^\/?#]+)/.exec(String(attr(link, 'href')).replace(/^https?:\/\/[^\/]+/, ''));
    if (!match || (matches(link, '.doujin_tags a') && match[1] !== 'doujins')) return;
    var where = resolve(match[1], match[2]);
    addOnce(found, item(where.directory, where.permalink, where.directory === match[1] ? ownText(link) || textOf(link) : nameOf(where.permalink)));
  });
  var wanted = function (entry) {
    var directory = /^https?:\/\/[^\/]+\/([^\/]+)\//.exec(entry.url)[1];
    if (directory === 'series') return types.indexOf('Series') >= 0;
    if (directory === 'chapters') return types.indexOf('Chapter') >= 0;
    if (directory === 'doujins') return types.indexOf('Doujin') >= 0;
    return true;
  };
  return { items: found.filter(wanted), hasNextPage: Boolean(first(doc, '.pagination [rel=next]')) };
}

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var tags = DYNASTY_TAGS.map(function (tag) { return { value: String(tag[0]), label: tag[1] }; });
  return [
    { type: 'select', key: 'sort', name: 'Sort (may not always apply)', options: options(SORTS), default: '' },
    { type: 'multi', key: 'types', name: 'Types', options: options(TYPES), default: TYPES.map(function (type) { return type[0]; }) },
    { type: 'multi', key: 'tags', name: 'With tags', options: tags, default: [] },
    { type: 'multi', key: 'notTags', name: 'Without tags', options: tags, default: [] },
    { type: 'text', key: 'author', name: 'Author (exact names, commas between)', placeholder: 'Saburouta', default: '' },
    { type: 'text', key: 'scanlator', name: 'Scanlator (exact names, commas between)', placeholder: '', default: '' },
    { type: 'text', key: 'pairing', name: 'Pairing (exact names, commas between)', placeholder: '', default: '' },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

function where(url) {
  var match = /^https?:\/\/[^\/]+\/([a-z]+)\/([^\/?#]+)/.exec(String(url));
  if (!match || DIRECTORIES.indexOf(match[1]) < 0) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return resolve(match[1], decodeURIComponent(match[2]).replace(/\.json$/, ''));
}

function chapterUrl(permalink) {
  return BASE + '/chapters/' + permalink;
}

function dayOf(text) {
  return /^\d{4}-\d\d-\d\d$/.test(String(text || '')) ? text + 'T00:00:00.000Z' : null;
}

function authorsOf(tags) {
  return (tags || []).filter(function (tag) { return tag.type === 'Author'; }).map(function (tag) { return tag.name; });
}

/** A collection's chapters in reading order, with volume headers put in front of their titles. */
function readingOrder(body) {
  var header = null;
  var rows = [];
  (body.taggings || []).forEach(function (entry) {
    if ('header' in entry) { header = entry.header; return; }
    if (entry.permalink) rows.push({ entry: entry, title: header ? header + ' ' + entry.title : entry.title });
  });
  // Series list oldest first; doujins, anthologies and issues newest first.
  return body.type === 'Series' ? rows : rows.reverse();
}

function chaptersOf(body) {
  var series = body.type === 'Series';
  var seen = {};
  var out = [];
  var last = 0;
  var extra = 0;
  readingOrder(body).forEach(function (row, index) {
    var entry = row.entry;
    var number = null;
    if (series) {
      var match = /(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i.exec(entry.title);
      if (match) { number = Number(match[1]); last = number; extra = 0; } else { extra += 1; number = Math.round((last + extra / 100) * 100) / 100; }
    } else {
      number = index + 1;
    }
    if (seen[number]) return;
    seen[number] = true;
    var title = row.title;
    var by = authorsOf(entry.tags);
    if (!series && by.length) title += ' by ' + by.join(' and ');
    out.push({ url: chapterUrl(entry.permalink), title: title, number: number, date: dayOf(entry.released_on) });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

/** A collection's JSON with every page of its list (up to MAX_PAGES). */
async function collection(place) {
  var path = '/' + place.directory + '/' + encodeURIComponent(place.permalink) + '.json';
  var body = await json(path);
  var pages = Math.min(Number(body.total_pages) || 1, MAX_PAGES);
  for (var p = 2; p <= pages; p++) {
    var more = await json(path + '?page=' + p);
    body.taggings = (body.taggings || []).concat(more.taggings || []);
  }
  body.cut = (Number(body.total_pages) || 1) > MAX_PAGES;
  return body;
}

/** Text from the description's HTML, links left out (they're the site's own cross-references). */
function plain(html) {
  return String(html || '').replace(/\\u([0-9a-fA-F]{4})/g, function (whole, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

function statusOf(tags) {
  var names = (tags || []).filter(function (tag) { return tag.type === 'Status'; }).map(function (tag) { return tag.name; });
  if (names.indexOf('Ongoing') >= 0) return 'ongoing';
  if (names.indexOf('Completed') >= 0) return 'completed';
  if (names.indexOf('On Hiatus') >= 0) return 'hiatus';
  if (names.some(function (name) { return /Dropped|Cancelled|Not Updated|Abandoned|Removed/.test(name); })) return 'cancelled';
  return null;
}

/** Tags other than authors and genres ("Pairing: A x B"), grouped as Keiyoushi lists them. */
function otherTags(tags) {
  var groups = {};
  (tags || []).forEach(function (tag) {
    if (tag.type === 'Author' || tag.type === 'General' || tag.type === 'Scanlator' || COLLECTIONS[tag.type]) return;
    (groups[tag.type] = groups[tag.type] || []).indexOf(tag.name) < 0 && groups[tag.type].push(tag.name);
  });
  return Object.keys(groups).map(function (type) { return type + ': ' + groups[type].join(', '); });
}

function unique(list) {
  return list.filter(function (value, i) { return value && list.indexOf(value) === i; });
}

async function chapterJson(permalink) {
  return json('/chapters/' + encodeURIComponent(permalink) + '.json');
}

async function getDetail(url) {
  var place = where(url);
  if (place.directory === 'chapters') {
    var single = await chapterJson(place.permalink);
    var lines = ['A single release.'].concat(otherTags(single.tags));
    if (single.released_on) lines.push('Released ' + single.released_on + '.');
    return {
      title: single.title,
      cover: single.pages && single.pages[0] ? absoluteUrl(single.pages[0].url) : null,
      description: lines.join('\n'),
      status: 'completed',
      genres: unique((single.tags || []).filter(function (tag) { return tag.type === 'General'; }).map(function (tag) { return tag.name; })),
      authors: unique(authorsOf(single.tags)),
      chapters: [{ url: chapterUrl(single.permalink), title: single.long_title || single.title, number: 1, date: dayOf(single.released_on) }],
    };
  }
  var body = await collection(place);
  var chapters = chaptersOf(body);
  var tags = (body.tags || []).slice();
  (body.taggings || []).forEach(function (entry) { if (entry.tags) tags = tags.concat(entry.tags); });
  var parts = [];
  var text = plain(body.description === 'None' ? '' : body.description);
  if (text) parts.push(text);
  var others = otherTags(tags);
  if (others.length) parts.push(others.join('\n'));
  if (body.aliases && body.aliases.length) parts.push('Also known as: ' + body.aliases.join(', '));
  if (body.cut) parts.unshift('Only the newest ' + MAX_PAGES * 25 + ' releases are listed here.');
  if (chapters.length === 0) parts.unshift('No chapters can be read on ' + SITE.name + ' right now.');
  var authors = unique(authorsOf(tags));
  return {
    title: body.name,
    cover: coverPath(body.cover) || knownCover(place.directory, place.permalink),
    description: parts.join('\n\n'),
    status: statusOf(body.tags),
    genres: unique(tags.filter(function (tag) { return tag.type === 'General'; }).map(function (tag) { return tag.name; })),
    authors: authors.length > 15 ? authors.slice(0, 15).concat(['…']) : authors,
    chapters: chapters,
  };
}

async function getChapters(url) {
  var place = where(url);
  if (place.directory === 'chapters') return (await getDetail(url)).chapters;
  return chaptersOf(await collection(place));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var match = /\/chapters\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var chapter = await chapterJson(decodeURIComponent(match[1]).replace(/\.json$/, ''));
  var pages = (chapter.pages || []).map(function (entry) { return absoluteUrl(entry.url); }).filter(Boolean);
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages.map(function (image) { return { url: image, headers: { 'User-Agent': AGENT } }; });
}
