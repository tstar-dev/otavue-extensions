// GigaViewer (Hatena's reader for Japanese publishers: Shōnen Jump+, Comic Days, Tonari no Young Jump…).
// Ported from Keiyoushi's GigaViewer (lib-multisrc/gigaviewer in github.com/keiyoushi/extensions-source,
// Apache-2.0): its GraphQL queries, the chapter list API, the page JSON and the tile layout of "baku" pages.
//
// The build puts `var SITE = { id, name, lang, baseUrl, lists, collections, homeSeries?, closedWithoutStatus? };`
// above this file, one copy per site.
//
// @theme gigaviewer
// @version 1.0.0
// @type manga

var BASE = SITE.baseUrl;
var LISTS = SITE.lists || [];
// Otavue doesn't sign in, so only chapters anyone can read are listed.
var MAX_CHAPTER_PAGES = 60;

/* ── requests ─────────────────────────────────────────────────────────── */

async function request(url, options) {
  var res = await fetch(url, options || {});
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) throw new Error(SITE.name + ' answered ' + res.status + '.');
  return res;
}

async function graphql(query, variables) {
  var res = await request(BASE + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: query, variables: variables || {} }),
  });
  var body = await res.json();
  if (body.errors && body.errors.length) throw new Error(SITE.name + ': ' + (body.errors[0].message || 'request refused'));
  return body.data;
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCodePoint(parseInt(dec, 10)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function base64(text) {
  // GraphQL node ids are base64 of "SerialGroup:<id>" or "Genre:<id>" (ASCII only).
  return btoa(text);
}

/* ── titles ───────────────────────────────────────────────────────────── */

var ITEM_FIELDS = 'databaseId title thumbnailUri firstEpisode { permalink } firstVolume { permalink } latestEpisode { publishedAt } latestVolume { thumbnailUri } likeCount';

function seriesUrl(id) {
  return BASE + '/series/' + id;
}

function seriesIdOf(url) {
  var match = /\/series\/(\d+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' series link.');
  return match[1];
}

function toItem(series) {
  // Series with nothing to open (no episode or volume yet) are left out.
  if (!series || !(series.firstEpisode || series.firstVolume)) return null;
  return {
    title: series.title,
    url: seriesUrl(series.databaseId),
    cover: series.thumbnailUri || (series.latestVolume && series.latestVolume.thumbnailUri) || null,
  };
}

function items(list) {
  return list.map(toItem).filter(Boolean);
}

/** The series in these lists ("SerialGroup" ids, or "Genre:<id>"), each once. */
async function seriesLists(ids) {
  if (!ids.length) return [];
  var names = ids.map(function (_, i) { return 'id' + i; });
  var query = 'query(' + names.map(function (n) { return '$' + n + ': ID!'; }).join(', ') + ') { ' +
    names.map(function (n) { return n + ': node(id: $' + n + ') { ...List }'; }).join(' ') + ' }\n' +
    'fragment List on Node { ... on SerialGroup { series { edges { node { ' + ITEM_FIELDS + ' } } } } ' +
    '... on Genre { series { edges { node { ' + ITEM_FIELDS + ' } } } } }';
  var variables = {};
  ids.forEach(function (id, i) { variables[names[i]] = base64(id.indexOf(':') >= 0 ? id : 'SerialGroup:' + id); });
  var data = await graphql(query, variables);
  var seen = {};
  var out = [];
  names.forEach(function (n) {
    var node = data[n];
    ((node && node.series && node.series.edges) || []).forEach(function (edge) {
      if (!seen[edge.node.databaseId]) { seen[edge.node.databaseId] = true; out.push(edge.node); }
    });
  });
  return out;
}

/** Sites whose API lists nothing (Comic Border): the series on their home page, by the id in each thumbnail. */
async function homeSeries() {
  var html = await (await request(BASE + '/')).text();
  var out = [];
  var seen = {};
  (html.match(/<section class="top-series[\s\S]*?<\/section>/g) || []).forEach(function (block) {
    var thumb = /data-src="([^"]*series-thumbnail\/(\d+)-[^"]*)"/.exec(block);
    var title = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block);
    if (!thumb || !title || seen[thumb[2]]) return;
    seen[thumb[2]] = true;
    out.push({ title: decodeEntities(title[1].replace(/<[^>]*>/g, '')).trim(), url: seriesUrl(thumb[2]), cover: decodeEntities(thumb[1]) });
  });
  return out;
}

/* ── browsing ─────────────────────────────────────────────────────────── */

function getInfo() {
  return { name: SITE.name, lang: SITE.lang, type: 'manga' };
}

async function popular() {
  if (SITE.homeSeries) return { items: await homeSeries(), hasNextPage: false };
  // Sites without likes report 0 for every series, which keeps the lists' own order.
  var list = (await seriesLists(LISTS)).slice().sort(function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0); });
  return { items: items(list), hasNextPage: false };
}

async function latest() {
  if (SITE.homeSeries) return { items: await homeSeries(), hasNextPage: false };
  var time = function (series) { return Date.parse((series.latestEpisode && series.latestEpisode.publishedAt) || '') || 0; };
  var list = (await seriesLists(LISTS)).slice().sort(function (a, b) { return time(b) - time(a); });
  return { items: items(list), hasNextPage: false };
}

function getFilters() {
  var collections = SITE.collections || [];
  if (!collections.length) return [];
  return [{
    type: 'select', key: 'collection', name: 'Collection', default: '0',
    options: collections.map(function (entry, i) { return { value: String(i), label: entry[0] }; }),
  }];
}

async function search(text, page, options) {
  var words = String(text || '').trim();
  if (words) {
    var data = await graphql('query Search($keyword: String!) { searchSeries(keyword: $keyword) { edges { node { ' + ITEM_FIELDS + ' } } } }', { keyword: words.slice(0, 100) });
    // Volume-only series (usually paid) go last.
    var found = data.searchSeries.edges.map(function (edge) { return edge.node; })
      .sort(function (a, b) { return (a.firstEpisode ? 0 : 1) - (b.firstEpisode ? 0 : 1); });
    return { items: items(found), hasNextPage: false };
  }
  var filters = (options && options.filters) || {};
  var collection = (SITE.collections || [])[parseInt(filters.collection || '0', 10)];
  if (!collection) return popular();
  return { items: items(await seriesLists(collection[1])), hasNextPage: false };
}

/* ── a title ──────────────────────────────────────────────────────────── */

function readable(product) {
  var info = product.purchase_info || {};
  if (!info.can_read || info.unavailable) return false;
  // Some sites report closed chapters as free; only their missing status gives them away.
  return !(SITE.closedWithoutStatus && !product.status);
}

/**
 * Every episode, newest first from the API, numbered by its place in the whole
 * series (so a number stays put as chapters open and close); only free ones are kept.
 */
async function chapterList(id, total) {
  var all = [];
  for (var page = 0; page < MAX_CHAPTER_PAGES && (total === undefined || all.length < total); page++) {
    var res = await request(BASE + '/api/viewer/pagination_readable_products?type=episode&aggregate_id=' + encodeURIComponent(id) +
      '&sort_order=desc&offset=' + all.length);
    var batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all = all.concat(batch);
  }
  var count = all.length;
  return all
    .map(function (product, i) { return { product: product, number: count - i }; })
    .filter(function (entry) { return readable(entry.product); })
    .reverse()
    .map(function (entry) {
      return { url: entry.product.viewer_uri, title: entry.product.title, number: entry.number, date: entry.product.display_open_at || null };
    });
}

async function getDetail(url) {
  var id = seriesIdOf(url);
  var data = await graphql(
    'query Series($id: String!) { series(databaseId: $id) { databaseId title author { name } description thumbnailUri ' +
      'latestVolume { thumbnailUri } episodes: readableProducts(types: [EPISODE], first: 0) { totalCount } } }',
    { id: id },
  );
  var series = data.series;
  if (!series) throw new Error(SITE.name + ' no longer has this series.');
  var chapters = await chapterList(id, series.episodes && series.episodes.totalCount);
  var description = String(series.description || '').trim();
  if (chapters.length === 0) {
    var note = 'No chapters are free to read right now. ' + SITE.name + ' sells the others on its own site.';
    description = description ? note + '\n\n' + description : note;
  }
  return {
    title: series.title,
    cover: series.thumbnailUri || (series.latestVolume && series.latestVolume.thumbnailUri) || null,
    description: description,
    authors: series.author && series.author.name ? [series.author.name] : [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return (await getDetail(url)).chapters;
}

/** GigaViewer's "baku" pages swap 8-pixel-aligned tiles across the diagonal of a 4 × 4 grid. */
var BAKU = {
  cols: 4,
  rows: 4,
  align: 8,
  map: [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15],
};

async function getPages(url) {
  if (String(url).indexOf(BASE + '/') !== 0) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var html = await (await request(url)).text();
  var match = /id=["']episode-json["'][^>]*data-value=(?:'([^']*)'|"([^"]*)")/.exec(html);
  if (!match) throw new Error(SITE.name + ' didn’t send this chapter’s pages.');
  var product = JSON.parse(decodeEntities(match[1] || match[2])).readableProduct;
  var structure = product && product.pageStructure;
  var pages = ((structure && structure.pages) || []).filter(function (page) { return page.type === 'main' && page.src; });
  if (pages.length === 0) throw new Error('This chapter isn’t free to read right now.');
  var scrambled = structure.choJuGiga === 'baku';
  return pages.map(function (page) {
    var out = { url: page.src };
    if (page.width && page.height) { out.width = page.width; out.height = page.height; }
    if (scrambled) out.scramble = BAKU;
    return out;
  });
}
