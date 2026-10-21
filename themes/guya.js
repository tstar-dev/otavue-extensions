// Guya (a reader with a small JSON API, run by scanlation groups: Guya, Danke fürs Lesen, Hachirumi,
// Magical Translators). Ported from Keiyoushi's Guya (lib-multisrc/guya in github.com/keiyoushi/extensions-source,
// Apache-2.0): its series and chapter endpoints, page paths, and choosing one group per chapter.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   onlySuffix     only titles whose slug ends with this ("-ES": Magical Translators' Spanish titles)
//   skipSuffixes   leave out titles whose slug ends with one of these (["-ES", "-PL"] for its English source)
//
// The whole catalogue comes in one answer, so lists have no next page and search filters it here.
//
// @theme guya
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(BASE + path, { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  return res.json();
}

/* ── titles ───────────────────────────────────────────────────────────── */

function mediaUrl(path) {
  path = String(path || '');
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path.replace(/^http:\/\//, 'https://');
  return BASE + '/' + path.replace(/^\/+/, '');
}

function seriesUrl(slug) {
  return BASE + '/read/manga/' + slug + '/';
}

function slugOf(url) {
  var match = /\/read\/manga\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return decodeURIComponent(match[1]);
}

function wanted(slug) {
  if (SITE.onlySuffix) return slug.slice(-SITE.onlySuffix.length) === SITE.onlySuffix;
  return !(SITE.skipSuffixes || []).some(function (suffix) { return slug.slice(-suffix.length) === suffix; });
}

/** The catalogue: `{ title: series }`, in the site's own order. */
async function catalogue() {
  var all = await api('/api/get_all_series/');
  return Object.keys(all || {}).map(function (title) {
    var series = all[title] || {};
    return { title: title, slug: String(series.slug || ''), cover: series.cover, updated: Number(series.last_updated) || 0 };
  }).filter(function (series) { return series.title && series.slug && wanted(series.slug); });
}

function toItem(series) {
  return { title: series.title, url: seriesUrl(series.slug), cover: mediaUrl(series.cover), coverHeaders: COVER_HEADERS };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function popular() {
  return { items: (await catalogue()).map(toItem), hasNextPage: false };
}

async function latest() {
  var series = await catalogue();
  series.sort(function (a, b) { return b.updated - a.updated; });
  return { items: series.map(toItem), hasNextPage: false };
}

async function search(text) {
  var query = String(text || '').trim().toLowerCase();
  var series = await catalogue();
  return { items: series.filter(function (one) { return one.title.toLowerCase().indexOf(query) >= 0; }).map(toItem), hasNextPage: false };
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Descriptions can be HTML that opens with the author's links (often an image in a link); those are dropped. */
function descriptionOf(text) {
  text = String(text || '');
  if (text.indexOf('<') < 0) return text.trim();
  var doc = parseHtml(text.replace(/<a\b[\s\S]*?<\/a>/gi, ''));
  return all(doc, 'p').map(textOf).filter(Boolean).join('\n\n') || textOf(doc);
}

/** The group a chapter is read from: the site's preferred order first, else the first group that has it. */
function groupFor(series, chapter, wantedGroup) {
  var groups = Object.keys(chapter.groups || {});
  if (wantedGroup && groups.indexOf(wantedGroup) >= 0) return wantedGroup;
  var order = (chapter.preferred_sort && chapter.preferred_sort.length ? chapter.preferred_sort : series.preferred_sort) || [];
  for (var i = 0; i < order.length; i++) if (groups.indexOf(String(order[i])) >= 0) return String(order[i]);
  return groups[0] || null;
}

/** "57.5" → "57-5", as the site's reader links write chapter numbers. */
function chapterUrl(slug, key, group) {
  return BASE + '/read/manga/' + slug + '/' + key.replace(/\./g, '-') + '/1/#' + group;
}

/** One chapter per number, oldest first, each from one group. */
function chaptersOf(series) {
  var out = [];
  Object.keys(series.chapters || {}).forEach(function (key) {
    var chapter = series.chapters[key];
    var number = Number(key);
    var group = groupFor(series, chapter);
    if (!isFinite(number) || !group || !(chapter.groups[group] || []).length) return;
    var released = chapter.release_date && Number(chapter.release_date[group]);
    var name = String(chapter.title || '').trim();
    out.push({
      url: chapterUrl(series.slug, key, group),
      title: 'Chapter ' + key + (name ? ' - ' + name : ''),
      number: number,
      date: released ? new Date(released * 1000).toISOString() : null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var series = await api('/api/series/' + encodeURIComponent(slugOf(url)) + '/');
  var chapters = chaptersOf(series);
  var description = descriptionOf(series.description);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var people = [series.author, series.artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(series.title || '').trim(),
    cover: mediaUrl(series.cover),
    coverHeaders: COVER_HEADERS,
    description: description,
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await api('/api/series/' + encodeURIComponent(slugOf(url)) + '/'));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var match = /\/read\/manga\/([^\/?#]+)\/([^\/?#]+)(?:\/[^#]*)?(?:#(.+))?$/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' chapter link.');
  var series = await api('/api/series/' + encodeURIComponent(decodeURIComponent(match[1])) + '/');
  var key = match[2].replace(/-/g, '.');
  var chapter = (series.chapters || {})[key];
  if (!chapter) throw new Error(SITE.name + ' no longer has this chapter.');
  var group = groupFor(series, chapter, match[3]);
  var files = (group && chapter.groups[group]) || [];
  if (files.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return files.map(function (file) {
    return {
      url: BASE + '/media/manga/' + series.slug + '/chapters/' + chapter.folder + '/' + group + '/' + String(file).replace(/^\/+/, ''),
      headers: { Referer: BASE + '/', 'User-Agent': AGENT },
    };
  });
}
