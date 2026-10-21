// Flame Comics (the group's own site, flamecomics.xyz, a Next.js app).
// Ported from Keiyoushi's Flame Comics (src/en/flamecomics in github.com/keiyoushi/extensions-source, Apache-2.0):
// the Next.js data routes (/_next/data/<build id>/browse.json, latest.json, series/<id>.json and
// series/<id>/<token>.json), the build id from the home page (renewed when a route answers 404), and image paths on
// cdn.flamecomics.xyz.
//
// The build puts `var SITE = { id, name, lang, baseUrl, cdnUrl };` above this file.
//
// The whole catalogue (about 170 series) comes in one file, so search, and the type, status and tag filters, run
// over it here. Novels are left out. Chapter links carry the series id and the chapter's token.
//
// @theme flamecomics
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var CDN = String(SITE.cdnUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/* ── requests ─────────────────────────────────────────────────────────── */

var buildId = null;

async function get(url) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Referer: BASE + '/' } });
  var text = await res.text();
  if (!res.ok && res.status !== 404) {
    if (/cf-chl|Just a moment/i.test(text)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return { status: res.status, text: text };
}

/** The site's current build id, read from the home page's __NEXT_DATA__. */
async function freshBuildId() {
  var home = await get(BASE + '/');
  var match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(home.text);
  var id = null;
  try { id = match && JSON.parse(match[1]).buildId; } catch (e) { id = null; }
  if (!id) throw new Error(SITE.name + ' changed its pages; this source needs an update.');
  buildId = id;
  return id;
}

/** A Next.js data route's `pageProps`; a 404 means a new deploy, so the build id is read again once. */
async function data(path) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var id = buildId && attempt === 0 ? buildId : await freshBuildId();
    var res = await get(BASE + '/_next/data/' + id + '/' + path);
    if (res.status === 404) continue;
    var body = null;
    try { body = JSON.parse(res.text); } catch (e) { body = null; }
    if (!body || !body.pageProps) throw new Error(SITE.name + ' answered with something other than its data.');
    if (body.pageProps.__N_REDIRECT || body.notFound) throw new Error(SITE.name + ' no longer has this.');
    return body.pageProps;
  }
  throw new Error(SITE.name + ' no longer has this.');
}

/* ── titles ───────────────────────────────────────────────────────────── */

function isNovel(series) {
  return /novel/i.test(String(series.type || ''));
}

function coverOf(series) {
  return series.cover ? CDN + '/' + series.series_id + '/' + encodeURIComponent(series.cover) + (series.last_edit ? '?' + series.last_edit : '') : null;
}

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (status === 'ongoing' || status === 'coming soon') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'dropped' || status === 'cancelled') return 'cancelled';
  return null;
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: BASE + '/series/' + series.series_id, cover: coverOf(series), status: statusOf(series.status) };
}

function listOf(series) {
  return (series || []).filter(function (entry) { return entry && entry.series_id && entry.title && !isNovel(entry); });
}

function tagsOf(series) {
  return series.categories || series.tags || [];
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function browse() {
  return listOf((await data('browse.json')).series);
}

async function popular(options) {
  if (options && options.page > 1) return { items: [], hasNextPage: false };
  var series = (await browse()).slice().sort(function (a, b) { return (Number(a.popularityRank) || 1e9) - (Number(b.popularityRank) || 1e9); });
  return { items: series.map(toItem), hasNextPage: false };
}

async function latest(options) {
  if (options && options.page > 1) return { items: [], hasNextPage: false };
  return { items: listOf((await data('latest.json')).allSeries).map(toItem), hasNextPage: false };
}

/** Lower case letters, digits and spaces, as Keiyoushi compares titles. */
function simple(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

async function search(text, pageNumber, options) {
  if (pageNumber > 1) return { items: [], hasNextPage: false };
  var query = simple(text).trim();
  var filters = (options && options.filters) || {};
  var series = (await browse()).filter(function (entry) {
    if (query && simple(entry.title).indexOf(query) < 0 && !(entry.altTitles || []).some(function (name) { return simple(name).indexOf(query) >= 0; })) return false;
    if (filters.type && String(entry.type).toLowerCase() !== filters.type) return false;
    if (filters.status && statusOf(entry.status) !== filters.status) return false;
    if (filters.tag && tagsOf(entry).indexOf(filters.tag) < 0) return false;
    return true;
  });
  return { items: series.map(toItem), hasNextPage: false };
}

async function getFilters() {
  var series = await browse();
  var tags = [];
  series.forEach(function (entry) { tagsOf(entry).forEach(function (tag) { if (tags.indexOf(tag) < 0) tags.push(tag); }); });
  tags.sort();
  return [
    { type: 'select', key: 'type', name: 'Type', options: [{ value: '', label: 'All' }, { value: 'manhwa', label: 'Manhwa' }, { value: 'manga', label: 'Manga' }, { value: 'manhua', label: 'Manhua' }, { value: 'comic', label: 'Comic' }], default: '' },
    { type: 'select', key: 'status', name: 'Status', options: [{ value: '', label: 'All' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }, { value: 'hiatus', label: 'Hiatus' }, { value: 'cancelled', label: 'Dropped' }], default: '' },
    { type: 'select', key: 'tag', name: 'Tag', options: [{ value: '', label: 'All' }].concat(tags.map(function (tag) { return { value: tag, label: tag }; })), default: '' },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

function seriesIdOf(url) {
  var match = /\/series\/(\d+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return match[1];
}

/** Text from the description's HTML. */
function plain(html) {
  return String(html || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

/** Released chapters, one per number, oldest first: "Chapter 21 - There's Always an Attack…". */
function chaptersOf(rows) {
  var now = Date.now() / 1000;
  var seen = {};
  var out = [];
  (rows || []).forEach(function (row) {
    var number = Number(row.chapter);
    if (!isFinite(number) || seen[number] || !row.token) return;
    if (Number(row.notice) || Number(row.draft) || Number(row.hidden) || Number(row.release_date) > now) return;
    seen[number] = true;
    var title = String(row.title || '').trim();
    out.push({
      url: BASE + '/series/' + row.series_id + '/' + row.token,
      title: 'Chapter ' + number + (title ? ' - ' + title : ''),
      number: number,
      date: Number(row.release_date) > 0 ? new Date(Number(row.release_date) * 1000).toISOString() : null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function seriesData(url) {
  var id = seriesIdOf(url);
  var props = await data('series/' + id + '.json?id=' + id);
  if (!props.series) throw new Error(SITE.name + ' no longer has this.');
  return props;
}

async function getDetail(url) {
  var props = await seriesData(url);
  var series = props.series;
  var novel = isNovel(series);
  var chapters = novel ? [] : chaptersOf(props.chapters);
  var description = plain(series.description);
  var also = (series.altTitles || []).map(function (name) { return String(name).trim(); }).filter(Boolean);
  if (also.length) description += (description ? '\n\n' : '') + 'Also known as: ' + also.join(', ');
  if (novel) description = 'This is a novel; Otavue only reads comics.' + (description ? '\n\n' + description : '');
  else if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var genres = [series.type].concat(tagsOf(series)).filter(Boolean);
  var authors = (series.author || []).concat(series.artist || []).map(function (name) { return String(name).trim(); });
  return {
    title: String(series.title || '').trim(),
    cover: coverOf(series),
    description: description,
    status: statusOf(series.status),
    genres: genres.filter(function (name, i) { return genres.indexOf(name) === i; }),
    authors: authors.filter(function (name, i) { return name && authors.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  var props = await seriesData(url);
  return isNovel(props.series) ? [] : chaptersOf(props.chapters);
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var match = /\/series\/(\d+)\/([0-9a-z]+)/i.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var chapter = (await data('series/' + match[1] + '/' + match[2] + '.json?id=' + match[1] + '&token=' + match[2])).chapter;
  var images = chapter && chapter.images ? chapter.images : {};
  // Keyed "0", "1", …: in page order by key.
  var keys = Object.keys(images).sort(function (a, b) { return Number(a) - Number(b); });
  var pages = keys.map(function (key) { return images[key]; }).filter(function (image) { return image && image.name; }).map(function (image) {
    return {
      url: CDN + '/' + chapter.series_id + '/' + chapter.token + '/' + encodeURIComponent(image.name) + (chapter.release_date ? '?' + chapter.release_date : ''),
      headers: { 'User-Agent': AGENT },
    };
  });
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages;
}
