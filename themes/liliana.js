// Liliana (a manga reader theme; ManhuaPlus at manhuaplus.org).
// Ported from Keiyoushi's Liliana (lib-multisrc/liliana in github.com/keiyoushi/extensions-source, Apache-2.0):
// the weekly ranking and /all-manga lists, /search and /filter pages, the filter options read from /filter, the
// title page's details and chapter list, and pages from /ajax/image/list/chap/<CHAPTER_ID>.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file, one copy per site.
//
// The page list comes shuffled, with each page's place in `data-index`; it's put back in order.
//
// @theme liliana
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

async function request(url, extra) {
  var headers = { 'User-Agent': AGENT, Referer: BASE + '/' };
  for (var key in extra || {}) headers[key] = extra[key];
  var res = await fetch(url, { headers: headers });
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

function imageOf(img, base) {
  return absolute(attr(img, 'data-lazy-src') || attr(img, 'data-src') || attr(img, 'src'), base);
}

/* ── lists ────────────────────────────────────────────────────────────── */

function itemsOf(doc) {
  var seen = {};
  var items = [];
  all(doc, 'div#main div.grid > div').forEach(function (card) {
    var link = first(card, '.text-center a');
    var url = absolute(attr(link, 'href'), doc.url).replace(/[?#].*$/, '');
    var title = textOf(link);
    if (!url || !title || seen[url]) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: imageOf(first(card, 'img'), doc.url) || null });
  });
  return { items: items, hasNextPage: Boolean(first(doc, '.blog-pager > span.pagecurrent + span')) };
}

async function popular(options) {
  return itemsOf(await page(BASE + '/ranking/week/' + ((options && options.page) || 1)));
}

async function latest(options) {
  return itemsOf(await page(BASE + '/all-manga/' + ((options && options.page) || 1) + '/?sort=last_update&status=0'));
}

function listOf(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

async function search(text, pageNumber, options) {
  var query = String(text || '').trim();
  pageNumber = pageNumber || 1;
  if (query) return itemsOf(await page(BASE + '/search/' + pageNumber + '/?keyword=' + encodeURIComponent(query)));
  var filters = (options && options.filters) || {};
  var params = { genres: listOf(filters.genres).join(','), notGenres: listOf(filters.notGenres).join(','), chapter_count: filters.count, status: filters.status, sex: filters.gender, sort: filters.sort };
  var parts = [];
  for (var key in params) if (params[key]) parts.push(key + '=' + encodeURIComponent(params[key]));
  return itemsOf(await page(BASE + '/filter/' + pageNumber + '/' + (parts.length ? '?' + parts.join('&') : '')));
}

/** The options of one of the filter page's `<select>`s. */
function selectOptions(doc, id) {
  return all(doc, '#' + id + ' > option').map(function (option) { return { value: attr(option, 'value'), label: textOf(option) }; });
}

async function getFilters() {
  var doc = await page(BASE + '/filter');
  var genres = all(doc, 'div.advanced-genres > div > .advance-item').map(function (item) {
    return { value: attr(first(item, 'span'), 'data-genre'), label: textOf(item) };
  }).filter(function (option) { return option.value && option.label; });
  var label = function (cls, fallback) { return textOf(first(doc, '.select-div > label.' + cls)) || fallback; };
  var any = function (list) { return list.some(function (option) { return option.value === ''; }) ? list : [{ value: '', label: 'Any' }].concat(list); };
  var filters = [];
  if (genres.length) {
    filters.push({ type: 'multi', key: 'genres', name: 'Genres (filters are ignored when searching by text)', options: genres, default: [] });
    filters.push({ type: 'multi', key: 'notGenres', name: 'Leave out genres', options: genres, default: [] });
  }
  [['count', 'select-count', 'Chapter count'], ['status', 'select-status', 'Status'], ['gender', 'select-gender', 'Gender'], ['sort', 'select-sort', 'Sort']].forEach(function (entry) {
    var list = selectOptions(doc, entry[1]);
    if (!list.length) return;
    if (entry[0] !== 'sort') list = any(list);
    filters.push({ type: 'select', key: entry[0], name: label(entry[1], entry[2]), options: list, default: list[0].value });
  });
  return filters;
}

/* ── details ──────────────────────────────────────────────────────────── */

function titleUrl(url) {
  var match = /^https?:\/\/[^\/]+\/manga\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return BASE + '/manga/' + match[1];
}

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (/^(ongoing|on-going)$/.test(status)) return 'ongoing';
  if (status === 'completed') return 'completed';
  if (/^(on-hold|on hold)$/.test(status)) return 'hiatus';
  if (/^(canceled|cancelled)$/.test(status)) return 'cancelled';
  return null;
}

/** An info line's value, found by its icon (`fa-user` for the author, `fa-rss` for the status). */
function infoValue(doc, icon) {
  return textOf(first(doc, 'div.y6x11p i.fas.' + icon + ' + span.dt'));
}

/** Every chapter, one per number, oldest first; times are Unix seconds. */
function chaptersOf(doc) {
  var seen = {};
  var out = [];
  all(doc, 'ul > li.chapter').forEach(function (row) {
    var link = first(row, 'a');
    var url = absolute(attr(link, 'href'), doc.url);
    var name = textOf(link);
    var number = numberOf(name, url);
    if (!url || number === null || seen[number]) return;
    seen[number] = true;
    var seconds = Number(attr(first(row, 'time[datetime]'), 'datetime'));
    out.push({ url: url, title: name, number: number, date: seconds > 0 ? new Date(seconds * 1000).toISOString() : null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var doc = await page(titleUrl(url));
  var heading = first(doc, '.a2 header h1');
  if (!heading) throw new Error(SITE.name + ' no longer has this.');
  var chapters = chaptersOf(doc);
  var description = textOf(first(doc, 'div#syn-target'));
  var also = textOf(first(doc, '.a2 header p')).replace(/^Other names?:\s*/i, '');
  if (also) description += (description ? '\n\n' : '') + 'Also known as: ' + also;
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var author = infoValue(doc, 'fa-user');
  return {
    title: textOf(heading),
    cover: imageOf(first(doc, '.a1 > figure img'), doc.url) || null,
    description: description,
    status: statusOf(infoValue(doc, 'fa-rss')),
    genres: all(doc, '.a2 div > a[rel=tag].label').map(textOf).filter(Boolean),
    authors: author && !/^updating$/i.test(author) ? author.split(/\s*,\s*/) : [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(titleUrl(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var link = String(url).replace(/#.*$/, '');
  var html = await (await request(link)).text();
  var id = (/const CHAPTER_ID\s*=\s*(\d+)/.exec(html) || [])[1];
  if (!id) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  var res = await request(BASE + '/ajax/image/list/chap/' + id, { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: link });
  var body = await res.json().catch(function () { return null; });
  if (!body || !body.status) throw new Error((body && body.msg) || 'This chapter has no pages on ' + SITE.name + '.');
  var doc = parseHtml(body.html || '');
  var cards = all(doc, 'div.separator');
  var ordered = cards.some(function (card) { return attr(card, 'data-index') !== ''; });
  var pages = cards.map(function (card, i) {
    return { index: ordered ? Number(attr(card, 'data-index')) : i, url: absolute(attr(first(card, 'a'), 'href'), link) };
  }).filter(function (entry) {
    var path = entry.url.toLowerCase().replace(/[?#].*$/, '');
    return entry.url && !/\.svg$/.test(path) && entry.url.toLowerCase().indexOf('loading_comments') < 0;
  }).sort(function (a, b) { return a.index - b.index; });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages.map(function (entry) { return { url: entry.url, headers: { 'User-Agent': AGENT } }; });
}
