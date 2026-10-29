// StoneScape's JSON API.
// Ported from Keiyoushi's StoneScape source (src/en/stonescape in
// github.com/keiyoushi/extensions-source, Apache-2.0): endpoints, response
// shapes, filters, chapter links and the pages/images fallback.
//
// @theme stonescape
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = BASE + '/api';
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/', 'User-Agent': AGENT };

var GENRES = [
  ['action', 'Action'], ['adaptation', 'Adaptation'], ['adult', 'Adult'], ['adventure', 'Adventure'],
  ['comedy', 'Comedy'], ['demons', 'Demons'], ['drama', 'Drama'], ['ecchi', 'Ecchi'], ['fantasy', 'Fantasy'],
  ['genderbender', 'Gender Bender'], ['gore', 'Gore'], ['harem', 'Harem'], ['historical', 'Historical'],
  ['horror', 'Horror'], ['isekai', 'Isekai'], ['josei', 'Josei'], ['magic', 'Magic'], ['martialarts', 'Martial Arts'],
  ['mature', 'Mature'], ['mecha', 'Mecha'], ['military', 'Military'], ['monsters', 'Monsters'], ['mystery', 'Mystery'],
  ['post-apocalyptic', 'Post-Apocalyptic'], ['psychological', 'Psychological'], ['romance', 'Romance'],
  ['schoollife', 'School Life'], ['sci-fi', 'Sci-Fi'], ['seinen', 'Seinen'], ['shoujo', 'Shoujo'],
  ['shoujoai', 'Shoujo Ai'], ['shounen', 'Shounen'], ['shounenai', 'Shounen Ai'], ['sliceoflife', 'Slice of Life'],
  ['smut', 'Smut'], ['sports', 'Sports'], ['supernatural', 'Supernatural'], ['thriller', 'Thriller'],
  ['tragedy', 'Tragedy'], ['video-games', 'Video Games'], ['webtoons', 'Webtoons'], ['wuxia', 'Wuxia'],
  ['yaoi', 'Yaoi'], ['yuri', 'Yuri'],
];

function headers(extra) {
  var out = { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' };
  for (var key in extra || {}) out[key] = extra[key];
  return out;
}

async function request(path) {
  var res = await fetch(/^https:/.test(path) ? path : API + path, { headers: headers() });
  if (res.ok) return res.json();
  if (res.status === 404) throw new Error('StoneScape no longer has this.');
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error('StoneScape wants a browser check. Open the site in Otavue, then try again.');
  }
  throw new Error('StoneScape answered ' + res.status + '.');
}

function absolute(path) {
  if (!path) return null;
  try { return new URL(path, BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return null; }
}

function itemOf(row) {
  return { title: String(row.title || '').trim(), url: BASE + '/series/' + row.slug, cover: absolute(row.coverUrl), coverHeaders: COVER_HEADERS };
}

function pageOf(data) {
  data = data || {};
  var pagination = data.pagination || {};
  return {
    items: (data.data || []).filter(function (row) { return row && row.title && row.slug; }).map(itemOf),
    hasNextPage: Number(pagination.page || 1) < Number(pagination.totalPages || 1),
  };
}

function params(values) {
  return values.filter(function (pair) { return pair[1] !== '' && pair[1] !== null && pair[1] !== undefined; })
    .map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

async function popular(options) {
  var page = (options && options.page) || 1;
  return pageOf(await request('/series/popular?' + params([['page', page], ['period', 'week'], ['contentType', 'manhwa'], ['limit', 24]])));
}

async function latest(options) {
  var page = (options && options.page) || 1;
  return pageOf(await request('/series?' + params([['page', page], ['limit', 24], ['contentType', 'manhwa']])));
}

function genreFor(query) {
  var normalized = String(query || '').replace(/[- ]/g, '').toLowerCase();
  for (var i = 0; i < GENRES.length; i++) {
    if (GENRES[i][0].toLowerCase() === String(query || '').toLowerCase() || GENRES[i][1].replace(/[- ]/g, '').toLowerCase() === normalized) return GENRES[i][0];
  }
  return null;
}

async function search(query, page, options) {
  var filters = (options && options.filters) || {};
  var genres = [].concat(filters.genres || []).filter(Boolean);
  var matched = genreFor(query);
  if (matched && genres.indexOf(matched) < 0) genres.push(matched);
  var values = [['page', page || 1], ['limit', 24], ['contentType', 'manhwa'], ['status', filters.status || '']];
  if (!matched) values.push(['search', String(query || '').trim()]);
  if (genres.length) values.push(['genres', genres.join(',')]);
  return pageOf(await request('/series?' + params(values)));
}

async function getFilters() {
  return [
    { type: 'select', key: 'status', name: 'Status', options: [
      { value: '', label: 'All' }, { value: 'ongoing', label: 'Ongoing' },
      { value: 'completed', label: 'Completed' }, { value: 'hiatus', label: 'Hiatus' },
    ], default: '' },
    { type: 'multi', key: 'genres', name: 'Genres', options: GENRES.map(function (pair) { return { value: pair[0], label: pair[1] }; }), default: [] },
  ];
}

function slugOf(url) {
  return decodeURIComponent((/\/series\/([^\/?#]+)/.exec(String(url || '')) || [])[1] || '');
}

function statusOf(value) {
  value = String(value || '').toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  if (value === 'hiatus') return 'hiatus';
  if (value === 'dropped' || value === 'cancelled' || value === 'canceled') return 'cancelled';
  return null;
}

function genreLabel(slug) {
  for (var i = 0; i < GENRES.length; i++) if (GENRES[i][0].toLowerCase() === String(slug || '').toLowerCase()) return GENRES[i][1];
  slug = String(slug || '');
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : '';
}

function isReadable(row) {
  if (!row) return false;
  if (row.locked === true || row.isFreeNow === false) return false;
  if (row.accessMode && row.accessMode !== 'free') return false;
  return row.status !== 'draft' && row.status !== 'scheduled';
}

function chaptersOf(data, slug) {
  var seen = {};
  var out = [];
  (data.chapters || []).filter(isReadable).forEach(function (row) {
    var number = parseFloat(row.chapterNumber);
    if (!Number.isFinite(number) || seen[number] || !row.chapterId) return;
    seen[number] = true;
    var formatted = String(number);
    out.push({
      url: BASE + '/series/' + slug + '/ch-' + formatted + '#' + row.chapterId,
      title: 'Chapter ' + formatted + (row.title ? ' - ' + row.title : ''),
      number: number,
      date: row.createdAt || row.publishedAt || null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getChapters(url) {
  var slug = slugOf(url);
  if (!slug) throw new Error('That isn’t a StoneScape title link.');
  return chaptersOf(await request('/series/by-slug/' + encodeURIComponent(slug) + '/chapters'), slug);
}

async function getDetail(url) {
  var slug = slugOf(url);
  if (!slug) throw new Error('That isn’t a StoneScape title link.');
  var detail = await request('/series/by-slug/' + encodeURIComponent(slug));
  if (!detail || !detail.title) throw new Error('That isn’t a StoneScape title.');
  var chapters = await getChapters(BASE + '/series/' + slug);
  var description = String(detail.description || '').trim();
  if (!chapters.length) description = 'No chapters are free to read on StoneScape right now.' + (description ? '\n\n' + description : '');
  return {
    title: detail.title,
    cover: absolute(detail.coverUrl),
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(detail.publicationStatus),
    genres: (detail.genres || []).map(genreLabel).filter(Boolean),
    authors: [detail.author, detail.artist].filter(Boolean).filter(function (name, index, list) { return list.indexOf(name) === index; }),
    chapters: chapters,
  };
}

async function getPages(url) {
  var id = String(url || '').split('#')[1];
  if (!id) throw new Error('That StoneScape chapter link is missing its id.');
  var data = await request('/chapters/' + encodeURIComponent(id) + '/pages');
  var rows = (data.pages && data.pages.length ? data.pages : data.images) || [];
  return rows.map(function (row, index) {
    return { url: absolute(row.url), width: row.width || undefined, height: row.height || undefined, order: row.pageNumber > 0 ? row.pageNumber : index + 1 };
  }).filter(function (row) { return row.url; }).sort(function (a, b) { return a.order - b.order; }).map(function (row) {
    return { url: row.url, width: row.width, height: row.height, headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
