// Comici Viewer (Japanese publishers' readers: TakeComic, Young Animal, Champion Cross…).
// Ported from Keiyoushi's ComiciViewer (lib-multisrc/comiciviewer in github.com/keiyoushi/extensions-source,
// Apache-2.0): its API endpoints, the ranking's Next.js data, list pages, and the per-image tile order.
//
// The build puts `var SITE = { id, name, lang, baseUrl, categories };` above this file, one copy per site.
//
// @theme comici
// @version 1.0.0
// @type manga

var BASE = SITE.baseUrl;
var API = BASE + '/api';
var RANKING = '/ranking/manga';
var SEARCH_SIZE = 24;
// Images are signed CloudFront links that also check where they're shown from.
var IMAGE_HEADERS = { Referer: BASE + '/' };

/* ── requests ─────────────────────────────────────────────────────────── */

async function request(url) {
  var res = await fetch(url, { headers: { Accept: 'application/json, text/html' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    // Comici sites answer with a "メンテナンス中" (maintenance) page while they're down.
    var body = await res.text().catch(function () { return ''; });
    if (/メンテナンス/.test(body)) throw new Error(SITE.name + ' is down for maintenance. Try again later.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return res;
}

async function api(path) {
  return (await request(API + path)).json();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCodePoint(parseInt(dec, 10)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function seriesUrl(hash) {
  return BASE + '/series/' + hash;
}

function hashOf(url) {
  var match = /\/series\/([0-9a-f]{6,})/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' series link.');
  return match[1];
}

function imageOf(series) {
  var list = (series.thumbnailImages && series.thumbnailImages.length ? series.thumbnailImages : series.images) || [];
  return list.length ? list[0].url : null;
}

/** Titles the publisher marks for adults stay out, whatever the source's own rating. */
function forAdults(series) {
  return Boolean(series.isSexualExpression || series.isExtremeExpression || (series.ageLimit && series.ageLimit >= 18));
}

function toItem(series) {
  return { title: series.name, url: seriesUrl(series.id), cover: imageOf(series), status: series.isCompleted ? 'completed' : 'ongoing' };
}

/** A list page (`div.series-list-item`), and whether it links to a next page. */
function listPage(html) {
  var items = [];
  var seen = {};
  // Each entry is `<div class="series-list-item">` around one link (the inner parts share the class prefix).
  (html.match(/<div class="series-list-item"[\s\S]*?<\/a>/g) || []).forEach(function (block) {
    var link = /href="[^"]*\/series\/([0-9a-f]{6,})/.exec(block);
    var title = /data-e2e="sliTitle"[^>]*>([^<]*)</.exec(block);
    if (!link || !title || seen[link[1]]) return;
    seen[link[1]] = true;
    var image = /<img[^>]*src="([^"]+)"/.exec(block);
    items.push({ title: decodeEntities(title[1]).trim(), url: seriesUrl(link[1]), cover: image ? decodeEntities(image[1]) : null });
  });
  return { items: items, hasNextPage: /g-pager-link mode-active[\s\S]{0,400}?class="g-pager-link/.test(html) };
}

/**
 * The ranking only exists in the page's Next.js data: each entry is a link with
 * its title, and a reference to a row holding its picture.
 */
function rankingOf(html) {
  var flight = '';
  var chunk = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  var match;
  while ((match = chunk.exec(html))) {
    try { flight += JSON.parse('"' + match[1] + '"'); } catch (_) { /* a chunk we don't need */ }
  }
  var entry = /"href":"\/series\/([0-9a-f]{6,})[^"]*"[^{}]{0,800}?"data-e2e":"sliLnk","children":\[\["\$","figure",null,\{"className":"series-list-item-fig","children":\["\$","picture",null,\{"children":"\$([0-9a-f]+)"\}\]\}\][\s\S]{0,1200}?"sliTitle","children":"((?:[^"\\]|\\.)*)"/g;
  var items = [];
  var seen = {};
  while ((match = entry.exec(flight))) {
    if (seen[match[1]]) continue;
    seen[match[1]] = true;
    var row = new RegExp('(?:^|\\n)' + match[2] + ':\\[[^\\n]*?"src":"(https://[^"]+)"').exec(flight);
    var title = match[3];
    try { title = JSON.parse('"' + title + '"'); } catch (_) { /* keep it as written */ }
    items.push({ title: title, url: seriesUrl(match[1]), cover: row ? row[1] : null });
  }
  return items;
}

/* ── browsing ─────────────────────────────────────────────────────────── */

function getInfo() {
  return { name: SITE.name, lang: SITE.lang, type: 'manga' };
}

async function categoryPage(path, page) {
  return listPage(await (await request(BASE + path + '/' + Math.max(1, page || 1))).text());
}

async function popular() {
  var items = rankingOf(await (await request(BASE + RANKING)).text());
  // The ranking's Next.js data may change shape; the update list is plain HTML.
  if (items.length === 0) return categoryPage('/series/list/up', 1);
  return { items: items, hasNextPage: false };
}

async function latest(options) {
  return categoryPage('/series/list/up', options && options.page);
}

function getFilters() {
  var categories = SITE.categories || [];
  return [{
    type: 'select', key: 'category', name: 'Category', default: RANKING,
    options: categories.map(function (entry) { return { value: entry[1], label: entry[0] }; }),
  }];
}

async function search(text, page, options) {
  var words = String(text || '').trim();
  if (words) {
    var body = await api('/search?q=' + encodeURIComponent(words.slice(0, 100)) + '&page=' + Math.max(1, page || 1) + '&size=' + SEARCH_SIZE);
    var result = body.searchResult.series;
    return {
      items: result.series.filter(function (series) { return !forAdults(series); }).map(toItem),
      hasNextPage: result.total > Math.max(1, page || 1) * SEARCH_SIZE,
    };
  }
  var path = (options && options.filters && options.filters.category) || RANKING;
  if (path === RANKING) return popular();
  if ((SITE.categories || []).every(function (entry) { return entry[1] !== path; })) throw new Error('Unknown category.');
  return categoryPage(path, page);
}

/* ── a title ──────────────────────────────────────────────────────────── */

/** Descriptions come as rich text (paragraphs of text runs, as JSON) or plain text. */
function descriptionOf(raw) {
  var text = String(raw || '');
  if (text.charAt(0) !== '[') return text.trim();
  try {
    var flatten = function (node) {
      if (!node) return '';
      if (typeof node.text === 'string') return node.text;
      return (node.children || []).map(flatten).join('');
    };
    return JSON.parse(text).map(flatten).join('\n').trim();
  } catch (_) {
    return text.trim();
  }
}

function seriesQuery(path, hash) {
  return api(path + '?seriesHash=' + encodeURIComponent(hash) + '&episodeFrom=1&episodeTo=9999');
}

async function getDetail(url) {
  var hash = hashOf(url);
  var results = await Promise.all([seriesQuery('/episodes', hash), seriesQuery('/series/access', hash)]);
  var series = results[0].series;
  var access = {};
  results[1].seriesAccess.episodeAccesses.forEach(function (entry) { access[entry.episodeId] = entry; });
  var summary = series.summary;
  // Oldest first; numbered by place in the whole series. Only chapters open without signing in are kept.
  var chapters = series.episodes
    .map(function (episode, i) { return { episode: episode, number: i + 1 }; })
    .filter(function (entry) { var a = access[entry.episode.id]; return !a || a.hasAccess; })
    .map(function (entry) {
      return {
        url: BASE + '/episodes/' + entry.episode.id,
        title: entry.episode.title,
        number: entry.number,
        date: entry.episode.datePublished ? new Date(entry.episode.datePublished * 1000).toISOString() : null,
      };
    });
  var description = descriptionOf(summary.description);
  if (chapters.length === 0) {
    var note = 'No chapters are free to read right now. ' + SITE.name + ' sells the others on its own site.';
    description = description ? note + '\n\n' + description : note;
  }
  var people = [];
  (summary.author || []).forEach(function (author) { if (author.name && people.indexOf(author.name) < 0) people.push(author.name); });
  return {
    title: summary.name,
    cover: imageOf(summary),
    description: description,
    status: summary.isCompleted ? 'completed' : 'ongoing',
    authors: people,
    chapters: chapters,
  };
}

async function getChapters(url) {
  return (await getDetail(url)).chapters;
}

/** Comici numbers a page's 4 × 4 tiles down each column; Otavue's map goes along each row. */
function scrambleOf(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '[]') return null;
  var tiles = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // A page that can't be put back would show jumbled; better to say so.
  if (!Array.isArray(tiles) || tiles.length !== 16) throw new Error(SITE.name + ' sent a page Otavue can’t put together.');
  var rowWise = function (i) { return (i % 4) * 4 + Math.floor(i / 4); };
  var map = new Array(16);
  tiles.forEach(function (tile, place) { map[rowWise(place)] = rowWise(Number(tile)); });
  return { cols: 4, rows: 4, align: 1, map: map };
}

async function getPages(url) {
  var match = /\/episodes\/([0-9a-f]{6,})/.exec(String(url));
  if (!match || String(url).indexOf(BASE + '/') !== 0) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var episode = (await api('/episodes/' + match[1])).episode;
  var viewer = (episode.content || []).filter(function (part) { return part.type === 'viewer'; })[0];
  if (!viewer) {
    // Some chapters are plain images, not the viewer.
    var images = (episode.content || []).filter(function (part) { return part.type === 'image' && part.url; });
    if (!images.length) throw new Error('This chapter isn’t free to read right now.');
    return images.map(function (part) { return { url: part.url, headers: IMAGE_HEADERS }; });
  }
  var info = '/book/contentsInfo?comici-viewer-id=' + encodeURIComponent(viewer.viewerId) + '&contentId=' + episode.contentId + '&user-id=&page-from=0&page-to=';
  var total = (await api(info + '0')).totalPages;
  var result = (await api(info + total)).result || [];
  if (!result.length) throw new Error('This chapter isn’t free to read right now.');
  return result
    .slice()
    .sort(function (a, b) { return a.sort - b.sort; })
    .map(function (page) {
      var out = { url: page.imageUrl, headers: IMAGE_HEADERS };
      if (page.width && page.height) { out.width = page.width; out.height = page.height; }
      var scramble = scrambleOf(page.scramble);
      if (scramble) out.scramble = scramble;
      return out;
    });
}
