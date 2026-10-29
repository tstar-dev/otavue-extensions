// Rinko Comics' custom WordPress reader.
// Ported from Keiyoushi's Rinko Comics source (src/en/rinkocomics in
// github.com/keiyoushi/extensions-source, Apache-2.0): selectors, filters,
// chapter pagination and nonce handling.
//
// @theme rinkocomics
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/', 'User-Agent': AGENT };

// @include lib/html.js

function headers(extra) {
  var out = { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: BASE + '/' };
  for (var key in extra || {}) out[key] = extra[key];
  return out;
}

async function request(url, options) {
  options = options || {};
  var res = await fetch(url, { method: options.method || 'GET', headers: headers(options.headers), body: options.body });
  if (res.ok) return res;
  if (res.status === 404) throw new Error('Rinko Comics no longer has this.');
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error('Rinko Comics wants a browser check. Open the site in Otavue, then try again.');
  }
  throw new Error('Rinko Comics answered ' + res.status + '.');
}

async function page(url) {
  var res = await request(url);
  var source = await res.text();
  var doc = parseHtml(source);
  doc.url = res.url || url;
  doc.source = source;
  return doc;
}

function absolute(href, base) {
  try { return new URL(String(href || '').trim(), base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function imageOf(el, base) {
  if (!el) return null;
  var value = attr(el, 'data-src') || attr(el, 'data-lazy-src') || attr(el, 'src');
  return value ? absolute(value, base) : null;
}

function item(link, title, image) {
  var url = absolute(attr(link, 'href'));
  title = clean(title);
  return url && title ? { title: title, url: url, cover: imageOf(image), coverHeaders: COVER_HEADERS } : null;
}

function queryUrl(path, params) {
  var parts = [];
  (params || []).forEach(function (pair) {
    if (pair[1] !== null && pair[1] !== undefined && pair[1] !== '') parts.push(encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]));
  });
  return BASE + path + (parts.length ? '?' + parts.join('&') : '');
}

function catalogueItems(doc) {
  var items = [];
  all(doc, 'article.ac-card').forEach(function (card) {
    var link = first(card, '.ac-title a');
    var found = item(link, textOf(link), first(card, '.ac-thumb img'));
    if (found) items.push(found);
  });
  return { items: items, hasNextPage: Boolean(first(doc, '.ac-pagination a.next')) };
}

async function popular() {
  var doc = await page(BASE + '/');
  var items = [];
  all(doc, '.comics-flex-pinned a.pinned-comic-card').forEach(function (card) {
    var found = item(card, textOf(first(card, '.pinned-comic-title')), first(card, '.comic-thumbnail img'));
    if (found) items.push(found);
  });
  return { items: items, hasNextPage: false };
}

async function latest(options) {
  var pageNumber = (options && options.page) || 1;
  var path = pageNumber > 1 ? '/comic/page/' + pageNumber + '/' : '/comic/';
  return catalogueItems(await page(queryUrl(path, [['sort', 'newest']])));
}

async function search(query, pageNumber, options) {
  var filters = (options && options.filters) || {};
  query = String(query || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
  pageNumber = pageNumber || 1;
  var path = pageNumber > 1 ? '/comic/page/' + pageNumber + '/' : '/comic/';
  var params = [['post_type', 'comic'], ['s', query], ['sort', filters.sort || 'newest']];
  [].concat(filters.genres || []).filter(Boolean).forEach(function (genre) { params.push(['genres[]', genre]); });
  return catalogueItems(await page(queryUrl(path, params)));
}

var genresCache = null;
async function genresOf() {
  if (genresCache) return genresCache;
  var doc = await page(BASE + '/comic/');
  var out = [];
  all(doc, '.ac-filter-group.ac-genre input[name]').forEach(function (input) {
    if (attr(input, 'name') !== 'genres[]') return;
    var slug = attr(input, 'value').trim();
    var name = textOf(first(input.parent || input, '.ac-option-text')).trim();
    if (slug && name) out.push({ value: slug, label: name });
  });
  genresCache = out;
  return out;
}

async function getFilters() {
  return [
    { type: 'multi', key: 'genres', name: 'Genres', options: await genresOf(), default: [] },
    { type: 'select', key: 'sort', name: 'Sort', options: [
      { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
      { value: 'az', label: 'A–Z' }, { value: 'za', label: 'Z–A' },
    ], default: 'newest' },
  ];
}

function statusOf(value) {
  value = String(value || '').trim().toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'hiatus') return 'hiatus';
  return null;
}

function unique(values) {
  var seen = {};
  return values.filter(function (value) {
    value = clean(value);
    var key = value.toLowerCase();
    if (!value || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function isLocked(el) {
  var reason = attr(el, 'data-reason').trim().toLowerCase();
  var href = attr(first(el, 'a'), 'href').trim();
  return (reason && reason !== 'free') || /\blocked-chapter\b/.test(attr(el, 'class')) || !href || href === '#' || Boolean(first(el, '.chapter_price'));
}

function chapterEntries(doc) {
  var out = [];
  all(doc, 'li.chapter').forEach(function (el) {
    if (isLocked(el)) return;
    var url = absolute(attr(el, 'data-permalink') || attr(first(el, 'a'), 'href'), doc.url);
    var title = textOf(first(el, '.chapter-number')) || attr(el, 'data-title');
    if (!url || !title) return;
    out.push({ url: url, title: title, date: dateOf(textOf(first(el, '.chapter-date')), 'MMM d, yyyy') });
  });
  return out;
}

function numbered(entries) {
  var seen = {};
  var out = [];
  entries.slice().reverse().forEach(function (entry) {
    var number = numberOf(entry.title, entry.url);
    if (number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: entry.url, title: entry.title, number: number, date: entry.date });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

function form(fields) {
  return fields.map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

async function moreChapters(comicId, offset, nonce) {
  var res = await request(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    body: form([['action', 'load_more_chapters'], ['nonce', nonce], ['comic_id', comicId], ['offset', String(offset)]]),
  });
  var data = await res.json();
  if (!data || !data.success || !data.data || !data.data.html) return [];
  var doc = parseHtml(data.data.html);
  doc.url = BASE + '/';
  return chapterEntries(doc);
}

async function chaptersOf(doc) {
  var entries = chapterEntries(doc);
  var button = first(doc, '#loadMoreChaptersBtn');
  var comicId = attr(button, 'data-comic-id').trim();
  var nonce = (/(?:var\s+)?comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/.exec(doc.source || '') || [])[1];
  var offset = parseInt(attr(button, 'data-offset'), 10);
  if (!Number.isFinite(offset) || offset <= 0 || offset > entries.length) offset = entries.length;
  if (comicId && nonce) {
    var known = {};
    entries.forEach(function (entry) { known[entry.url] = true; });
    for (var attempt = 0; attempt < 100; attempt++) {
      var more = await moreChapters(comicId, offset, nonce);
      if (!more.length) break;
      var added = 0;
      more.forEach(function (entry) {
        if (!known[entry.url]) { known[entry.url] = true; entries.push(entry); added++; }
      });
      if (!added) break;
      offset += 10;
    }
  }
  return numbered(entries);
}

async function getDetail(url) {
  var doc = await page(absolute(url));
  var title = textOf(first(doc, '.comic-info-upper h1')) || textOf(first(doc, 'h1'));
  if (!title) throw new Error('That isn’t a Rinko Comics title page.');
  var graph = all(doc, '.comic-graph > span').map(textOf).filter(function (value) { return value && value !== '•'; });
  var author = graph.filter(function (value) { return !/^\d[\d,.]*$/.test(value) && !/^(manga|manhwa|manhua|comic)$/i.test(value); })[0];
  var type = graph.filter(function (value) { return /^(manga|manhwa|manhua|comic)$/i.test(value); })[0];
  var genres = all(doc, '.comic-genres .genres .genre').map(textOf);
  if (type) genres.push(type);
  var description = textOf(first(doc, '.comic-synopsis'));
  var alt = all(doc, '.alt-titles-list .alt-title').map(textOf).filter(Boolean);
  if (alt.length) description += (description ? '\n\n' : '') + 'Also known as: ' + alt.join(', ');
  var chapters = await chaptersOf(doc);
  if (!chapters.length) description = 'No chapters are free to read on Rinko Comics right now.' + (description ? '\n\n' + description : '');
  return {
    title: title,
    cover: absolute(attr(first(doc, 'meta[property="og:image"]'), 'content'), doc.url) || null,
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(textOf(first(doc, '.comic-status span:last-child'))),
    genres: unique(genres),
    authors: author ? [author] : [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await page(absolute(url)));
}

async function getPages(url) {
  url = absolute(url);
  var doc = await page(url);
  var out = [];
  all(doc, 'img.chapter-image').forEach(function (img) {
    var image = imageOf(img, doc.url);
    if (image) out.push({ url: image, headers: { Referer: url, 'User-Agent': AGENT } });
  });
  if (!out.length) throw new Error('This chapter is locked or unavailable on Rinko Comics.');
  return out;
}
