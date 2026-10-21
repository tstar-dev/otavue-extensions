// Iken (a reader with a JSON API at api.<site>; Vortex Scans, Hive Scans, Ken Scans and other groups).
// Ported from Keiyoushi's Iken (lib-multisrc/iken in github.com/keiyoushi/extensions-source, Apache-2.0):
// its query, post, chapter-list and chapter endpoints, filters, and how it leaves out locked chapters and novels.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   apiUrl              the API ("https://api.<site>")
//   perPage             titles per list page (18)
//   sortPagesByFilename order pages by the number in their file name, not the API's order (Magus Manga, Sana Scans)
//
// @theme iken
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl || BASE.replace('://', '://api.')).replace(/\/+$/, '');
var PER_PAGE = SITE.perPage || 18;
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var API_HEADERS = { 'User-Agent': AGENT, Accept: 'application/json, text/plain, */*', Origin: BASE, Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(API + path, { headers: API_HEADERS });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return res.json();
}

function query(params) {
  return Object.keys(params).filter(function (key) { return params[key] !== '' && params[key] !== undefined; })
    .map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
}

/* ── links ────────────────────────────────────────────────────────────── */

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/** The site's own link, with the API's id after `#`; just the id when the slug makes it too long for Otavue. */
function linkOf(path, id, short) {
  var url = BASE + path + '#' + id;
  return byteLength(url) <= MAX_URL_BYTES ? url : BASE + short + '#' + id;
}

function seriesUrl(post) {
  return linkOf('/series/' + post.slug, post.id, '/series/');
}

function chapterUrl(slug, chapter) {
  return linkOf('/series/' + slug + '/' + chapter.slug, chapter.id, '/chapter/');
}

/** `{ id }` from a link's `#id`, or `{ slug }` from a plain /series/<slug> link. */
function postOf(url) {
  var id = /#(\d+)$/.exec(String(url));
  if (id) return { id: id[1] };
  var slug = /\/series\/([^\/?#]+)/.exec(String(url));
  if (!slug) throw new Error('That isn’t a ' + SITE.name + ' title link.');
  return { slug: decodeURIComponent(slug[1]) };
}

/* ── titles ───────────────────────────────────────────────────────────── */

function isNovel(post) {
  return Boolean(post.isNovel) || String(post.seriesType || '').toUpperCase() === 'NOVEL';
}

function statusOf(value) {
  var status = String(value || '').toUpperCase();
  if (status === 'ONGOING' || status === 'COMING_SOON' || status === 'MASS_RELEASED') return 'ongoing';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED' || status === 'DROPPED') return 'cancelled';
  if (status === 'HIATUS') return 'hiatus';
  return null;
}

function imageUrl(url) {
  return url ? String(url).replace(/^http:\/\//, 'https://').replace(/ /g, '%20') : null;
}

function toItem(post) {
  return { title: String(post.postTitle || '').trim(), url: seriesUrl(post), cover: imageUrl(post.featuredImage), status: statusOf(post.seriesStatus) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['totalViews', 'Views'], ['lastChapterAddedAt', 'Latest chapter'], ['createdAt', 'Added'], ['chaptersCount', 'Chapters'], ['postTitle', 'Title']];
var STATUSES = [['', 'All'], ['ONGOING', 'Ongoing'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled'], ['DROPPED', 'Dropped'], ['COMING_SOON', 'Coming soon'], ['MASS_RELEASED', 'Mass released']];
var TYPES = [['', 'All'], ['MANGA', 'Manga'], ['MANHUA', 'Manhua'], ['MANHWA', 'Manhwa'], ['RUSSIAN', 'Russian'], ['SPANISH', 'Spanish']];

/** `/api/query`: `perPage` posts a page and a `totalCount`. Novels share the list; they're left out. */
async function list(pageNumber, options) {
  var body = await api('/api/query?' + query({
    page: pageNumber,
    perPage: PER_PAGE,
    searchTerm: options.query || '',
    orderBy: options.orderBy || 'totalViews',
    orderDirection: options.direction,
    seriesStatus: options.status,
    seriesType: options.type,
    genreIds: (options.genres || []).join(','),
  }));
  var posts = body.posts || [];
  return {
    items: posts.filter(function (post) { return !isNovel(post); }).map(toItem).filter(function (item) { return item.title; }),
    hasNextPage: Number(body.totalCount) > pageNumber * PER_PAGE,
  };
}

async function popular(options) {
  return list((options && options.page) || 1, { orderBy: 'totalViews' });
}

async function latest(options) {
  return list((options && options.page) || 1, { orderBy: 'lastChapterAddedAt' });
}

async function search(text, pageNumber, options) {
  var filters = (options && options.filters) || {};
  return list(pageNumber || 1, {
    query: String(text || '').trim(),
    orderBy: filters.sort,
    direction: filters.ascending ? 'asc' : filters.sort ? 'desc' : undefined,
    status: filters.status,
    type: filters.type,
    genres: [].concat(filters.genres || []).filter(Boolean),
  });
}

async function getFilters() {
  var genres = await api('/api/genres').catch(function () { return []; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [
    { type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'totalViews' },
    { type: 'toggle', key: 'ascending', name: 'Ascending', default: false },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' },
    { type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' },
  ];
  if (Array.isArray(genres) && genres.length) {
    out.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres.map(function (genre) { return { value: String(genre.id), label: genre.name }; }), default: [] });
  }
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

async function postFor(url) {
  var ref = postOf(url);
  var body = await api('/api/post?' + (ref.id ? query({ postId: ref.id }) : query({ postSlug: ref.slug })));
  if (!body.post) throw new Error(SITE.name + ' no longer has this.');
  if (isNovel(body.post)) throw new Error('This is a novel; Otavue reads ' + SITE.name + '’s comics only.');
  return body.post;
}

function descriptionOf(post) {
  var doc = parseHtml(String(post.postContent || '').replace(/\r?\n/g, '<br>'));
  var text = all(doc, 'p').map(textOf).filter(Boolean).join('\n\n') || textOf(doc);
  var alt = String(post.alternativeTitles || '').trim();
  if (alt) text = (text ? text + '\n\n' : '') + 'Also known as: ' + alt;
  return text;
}

/** Locked (coins, a short link, or waiting to unlock) chapters need an account. */
function isLocked(chapter) {
  if (chapter.isAccessible === false) return true;
  if (chapter.isLocked || chapter.isTimeLocked || chapter.isPermanentlyLocked || chapter.isShortLinkLocked) return true;
  if (chapter.price > 0 && !chapter.chapterPurchased) return true;
  return Boolean(chapter.unlockAt && Date.parse(chapter.unlockAt) > Date.now());
}

/** Free chapters, one per number, oldest first. The post itself often lists none, so they come from /api/chapters. */
async function chaptersOf(post) {
  var body = await api('/api/chapters?' + query({ postId: post.id }));
  var rows = (body.post && body.post.chapters) || [];
  var seen = {};
  var out = [];
  rows.forEach(function (chapter) {
    if (isLocked(chapter)) return;
    var number = Number(chapter.number);
    if (!isFinite(number) || seen[number]) return;
    seen[number] = true;
    var title = String(chapter.title || '').trim();
    out.push({
      url: chapterUrl(post.slug, chapter),
      title: 'Chapter ' + number + (title ? ' - ' + title : ''),
      number: number,
      date: chapter.createdAt || null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var post = await postFor(url);
  var chapters = await chaptersOf(post);
  var description = descriptionOf(post);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' without an account right now.' + (description ? '\n\n' + description : '');
  var type = { MANGA: 'Manga', MANHUA: 'Manhua', MANHWA: 'Manhwa' }[String(post.seriesType || '').toUpperCase()];
  var genres = (post.genres || []).map(function (genre) { return genre.name; }).filter(Boolean);
  if (type) genres.unshift(type);
  var people = [post.author, post.artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(post.postTitle || '').trim(),
    cover: imageUrl(post.featuredImage),
    description: description,
    status: statusOf(post.seriesStatus),
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await postFor(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** The first number in a page's file name ("page-0003_01_…webp" → 3), as Keiyoushi sorts them. */
function fileNumber(url) {
  var match = /\d+/.exec(String(url).replace(/[?#].*$/, '').replace(/^.*\//, ''));
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function orderOf(image) {
  return typeof image.order === 'number' ? image.order : Number.MAX_SAFE_INTEGER;
}

async function getPages(url) {
  var id = /#(\d+)$/.exec(String(url));
  if (!id) throw new Error('Open the title again to refresh its chapters.');
  var body = await api('/api/chapter?' + query({ chapterId: id[1] }));
  var chapter = body.chapter || {};
  var images = (chapter.images || []).filter(function (image) { return image && image.url; });
  if (images.length === 0) {
    if (chapter.isLockedByCoins || chapter.isShortLinkLocked || chapter.isPermanentlyLocked || chapter.isAccessible === false) throw new Error('This chapter is locked on ' + SITE.name + '.');
    throw new Error('This chapter has no pages on ' + SITE.name + '.');
  }
  var key = SITE.sortPagesByFilename ? function (image) { return fileNumber(image.url); } : orderOf;
  images = images.slice().sort(function (a, b) { return key(a) - key(b); });
  return images.map(function (image) {
    var page = { url: imageUrl(image.url), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
    if (image.width > 0 && image.height > 0) { page.width = image.width; page.height = image.height; }
    return page;
  });
}
