// MangaDex, read through its public API (https://api.mangadex.org/docs/).
// Written for Otavue from the API documentation; no other extension's code is used.
//
// The build puts `var SITE = { id, name, lang, ... };` above this file, one copy per language.
//
// @theme mangadex
// @version 1.0.0
// @type manga

var API = 'https://api.mangadex.org';
var WEB = 'https://mangadex.org';
var COVERS = 'https://uploads.mangadex.org/covers';
var LANG = (typeof SITE !== 'undefined' && SITE.lang) || 'en';
var PAGE_SIZE = 24;
// 18+ titles stay out: Otavue shows a source's titles to everyone unless the whole source is marked 18+.
var RATINGS = ['safe', 'suggestive'];
// MangaDex refuses offsets past 10,000.
var MAX_OFFSET = 10000;
// MangaDex asks API clients to name themselves.
var HEADERS = { 'User-Agent': 'Otavue (+https://github.com/tstar-dev/otavue-extensions)', Accept: 'application/json' };

/* ── requests ─────────────────────────────────────────────────────────── */

function query(params) {
  var parts = [];
  Object.keys(params).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { parts.push(encodeURIComponent(key + '[]') + '=' + encodeURIComponent(item)); });
    } else {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
  });
  return parts.join('&');
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function api(path, params) {
  var url = API + path + (params ? '?' + query(params) : '');
  for (var attempt = 0; attempt < 3; attempt++) {
    var res = await fetch(url, { headers: HEADERS });
    // A short burst over the rate limit; it clears within a second or two.
    if (res.status === 429 && attempt < 2) { await wait(1500 * (attempt + 1)); continue; }
    if (res.status === 503) throw new Error('MangaDex is down for maintenance. Try again later.');
    if (res.status === 404) throw new Error('MangaDex no longer has this.');
    if (!res.ok) throw new Error('MangaDex answered ' + res.status + '.');
    var body = await res.json();
    if (body && body.result === 'error') {
      var detail = body.errors && body.errors[0] && (body.errors[0].detail || body.errors[0].title);
      throw new Error('MangaDex: ' + (detail || 'request refused'));
    }
    return body;
  }
  throw new Error('MangaDex is busy. Try again in a moment.');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function firstValue(map) {
  var keys = map ? Object.keys(map) : [];
  return keys.length ? map[keys[0]] : '';
}

function inLang(map, lang) {
  return map && map[lang] ? map[lang] : '';
}

/** The main title (often romanised), and a title in the source's language when MangaDex has one. */
function titlesOf(attributes) {
  var main = firstValue(attributes.title) || 'Untitled';
  var alt = attributes.altTitles || [];
  var local = inLang(attributes.title, LANG);
  for (var i = 0; !local && i < alt.length; i++) local = inLang(alt[i], LANG);
  // Readers of other languages still recognise the English name more often than the romanised one.
  for (var j = 0; !local && LANG !== 'en' && j < alt.length; j++) local = inLang(alt[j], 'en');
  return { title: main, englishTitle: local && local !== main ? local : null };
}

function related(manga, type) {
  return (manga.relationships || []).filter(function (rel) { return rel.type === type; });
}

function coverOf(manga) {
  var art = related(manga, 'cover_art')[0];
  var file = art && art.attributes && art.attributes.fileName;
  return file ? COVERS + '/' + manga.id + '/' + file + '.512.jpg' : null;
}

function titleUrl(id) {
  return WEB + '/title/' + id;
}

function idFrom(url, kind) {
  var match = new RegExp('/' + kind + '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})').exec(String(url));
  if (!match) throw new Error('That isn’t a MangaDex ' + kind + ' link.');
  return match[1];
}

function toItem(manga) {
  var names = titlesOf(manga.attributes);
  return {
    title: names.title,
    englishTitle: names.englishTitle,
    url: titleUrl(manga.id),
    cover: coverOf(manga),
    status: manga.attributes.status || null,
  };
}

function pageOf(body, offset) {
  var next = offset + body.limit;
  return { items: body.data.map(toItem), hasNextPage: next < body.total && next < MAX_OFFSET };
}

function listParams(page, extra) {
  var offset = (Math.max(1, page || 1) - 1) * PAGE_SIZE;
  var params = {
    limit: Math.min(PAGE_SIZE, MAX_OFFSET - offset),
    offset: offset,
    includes: ['cover_art'],
    contentRating: RATINGS,
    availableTranslatedLanguage: [LANG],
  };
  Object.keys(extra || {}).forEach(function (key) { params[key] = extra[key]; });
  return params;
}

async function mangaList(page, extra) {
  var params = listParams(page, extra);
  if (params.limit <= 0) return { items: [], hasNextPage: false };
  return pageOf(await api('/manga', params), params.offset);
}

/* ── browsing ─────────────────────────────────────────────────────────── */

function getInfo() {
  return { name: (typeof SITE !== 'undefined' && SITE.name) || 'MangaDex', lang: LANG, type: 'manga' };
}

async function popular(options) {
  return mangaList(options && options.page, { 'order[followedCount]': 'desc' });
}

/**
 * Titles with newly readable chapters, newest first. Built from the chapter
 * list, so every title in it has something to read here (a title's own
 * "latest upload" also counts chapters that only link to a publisher).
 */
async function latest(options) {
  var page = Math.max(1, (options && options.page) || 1);
  var limit = 100;
  var offset = (page - 1) * limit;
  if (offset >= MAX_OFFSET) return { items: [], hasNextPage: false };
  var chapters = await api('/chapter', {
    limit: limit,
    offset: offset,
    translatedLanguage: [LANG],
    'order[readableAt]': 'desc',
    includeExternalUrl: 0,
    includeFuturePublishAt: 0,
    contentRating: RATINGS,
  });
  var ids = [];
  chapters.data.forEach(function (chapter) {
    related(chapter, 'manga').forEach(function (rel) { if (ids.indexOf(rel.id) < 0) ids.push(rel.id); });
  });
  var more = offset + limit < chapters.total && offset + limit < MAX_OFFSET;
  if (ids.length === 0) return { items: [], hasNextPage: more };
  var titles = await api('/manga', { limit: 100, ids: ids, includes: ['cover_art'], contentRating: RATINGS });
  var byId = {};
  titles.data.forEach(function (manga) { byId[manga.id] = manga; });
  return {
    items: ids.filter(function (id) { return byId[id]; }).map(function (id) { return toItem(byId[id]); }),
    hasNextPage: more,
  };
}

var ORDERS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'followedCount', label: 'Most followed' },
  { value: 'latestUploadedChapter', label: 'Latest upload' },
  { value: 'rating', label: 'Top rated' },
  { value: 'createdAt', label: 'Newly added' },
  { value: 'title', label: 'Title A–Z' },
];

var tagCache = null;

async function getFilters() {
  if (!tagCache) {
    var body = await api('/manga/tag');
    // The "content" group (gore, sexual violence) stays out, like the 18+ ratings.
    tagCache = body.data
      .filter(function (tag) { return tag.attributes.group !== 'content'; })
      .map(function (tag) { return { value: tag.id, label: tag.attributes.name.en || firstValue(tag.attributes.name) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label); });
  }
  return [
    { type: 'select', key: 'order', name: 'Sort by', options: ORDERS, default: 'relevance' },
    {
      type: 'select', key: 'status', name: 'Status', default: 'any',
      options: [
        { value: 'any', label: 'Any' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' },
        { value: 'hiatus', label: 'On hiatus' }, { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    {
      type: 'select', key: 'demographic', name: 'Demographic', default: 'any',
      options: [
        { value: 'any', label: 'Any' }, { value: 'shounen', label: 'Shōnen' }, { value: 'shoujo', label: 'Shōjo' },
        { value: 'seinen', label: 'Seinen' }, { value: 'josei', label: 'Josei' },
      ],
    },
    { type: 'multi', key: 'tags', name: 'Genres and themes', options: tagCache, default: [] },
  ];
}

async function search(text, page, options) {
  var filters = (options && options.filters) || {};
  var words = String(text || '').trim();
  var order = filters.order && filters.order !== 'relevance' ? filters.order : words ? 'relevance' : 'followedCount';
  var extra = {};
  if (words) extra.title = words.slice(0, 200);
  extra['order[' + order + ']'] = order === 'title' ? 'asc' : 'desc';
  if (filters.status && filters.status !== 'any') extra.status = [filters.status];
  if (filters.demographic && filters.demographic !== 'any') extra.publicationDemographic = [filters.demographic];
  if (Array.isArray(filters.tags) && filters.tags.length) extra.includedTags = filters.tags.slice(0, 20);
  return mangaList(page, extra);
}

/* ── a title ──────────────────────────────────────────────────────────── */

function plainText(markdown) {
  return String(markdown || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chapterNumber(attributes) {
  var n = parseFloat(attributes.chapter);
  // Oneshots and extras have no number; they sort first.
  return isFinite(n) ? n : 0;
}

function chapterTitle(chapter) {
  var attributes = chapter.attributes;
  var group = related(chapter, 'scanlation_group')[0];
  var groupName = group && group.attributes && group.attributes.name;
  var name = attributes.title || (attributes.chapter ? '' : 'Oneshot');
  var volume = attributes.volume ? 'Vol. ' + attributes.volume : '';
  return [volume, name, groupName].filter(Boolean).join(' · ');
}

var chapterCache = {};

/**
 * The chapters that can be read here, one per number (MangaDex often has the
 * same chapter from several groups; the first listed is kept), and how many
 * only link to an official publisher.
 */
async function chapterList(id) {
  var hit = chapterCache[id];
  if (hit && hit.until > Date.now()) return hit.value;
  var readable = [];
  var external = 0;
  var seen = {};
  for (var offset = 0; offset < MAX_OFFSET; offset += 500) {
    var body = await api('/manga/' + id + '/feed', {
      limit: 500,
      offset: offset,
      translatedLanguage: [LANG],
      'order[volume]': 'asc',
      'order[chapter]': 'asc',
      includes: ['scanlation_group'],
      includeFuturePublishAt: 0,
    });
    body.data.forEach(function (chapter) {
      var attributes = chapter.attributes;
      if (attributes.externalUrl || attributes.isUnavailable || !(attributes.pages > 0)) { external++; return; }
      var number = chapterNumber(attributes);
      if (seen[number]) return;
      seen[number] = true;
      readable.push({
        url: WEB + '/chapter/' + chapter.id,
        title: chapterTitle(chapter),
        number: number,
        date: attributes.readableAt || attributes.publishAt || null,
      });
    });
    if (offset + 500 >= body.total) break;
  }
  readable.sort(function (a, b) { return a.number - b.number; });
  var value = { chapters: readable, external: external };
  chapterCache[id] = { until: Date.now() + 60000, value: value };
  return value;
}

async function getDetail(url) {
  var id = idFrom(url, 'title');
  var body = await api('/manga/' + id, { includes: ['cover_art', 'author', 'artist'] });
  var manga = body.data;
  var attributes = manga.attributes;
  var names = titlesOf(attributes);
  var list = await chapterList(id);
  var people = [];
  related(manga, 'author').concat(related(manga, 'artist')).forEach(function (rel) {
    var name = rel.attributes && rel.attributes.name;
    if (name && people.indexOf(name) < 0) people.push(name);
  });
  var description = plainText(inLang(attributes.description, LANG) || inLang(attributes.description, 'en'));
  if (list.chapters.length === 0) {
    var note = list.external > 0
      ? 'There are no chapters to read here: MangaDex only links to the official publisher for this title.'
      : 'MangaDex has no chapters of this title in this language yet.';
    description = description ? note + '\n\n' + description : note;
  }
  return {
    title: names.title,
    englishTitle: names.englishTitle,
    cover: coverOf(manga),
    description: description,
    status: attributes.status || null,
    genres: (attributes.tags || [])
      .filter(function (tag) { return tag.attributes.group === 'genre' || tag.attributes.group === 'theme'; })
      .map(function (tag) { return tag.attributes.name.en || firstValue(tag.attributes.name); }),
    authors: people,
    year: attributes.year || null,
    chapters: list.chapters,
  };
}

async function getChapters(url) {
  return (await chapterList(idFrom(url, 'title'))).chapters;
}

async function getPages(url) {
  var body = await api('/at-home/server/' + idFrom(url, 'chapter'));
  var chapter = body.chapter;
  if (!chapter || !chapter.data || chapter.data.length === 0) throw new Error('MangaDex has no pages for this chapter.');
  return chapter.data.map(function (file) { return body.baseUrl + '/data/' + chapter.hash + '/' + file; });
}
