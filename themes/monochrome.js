// Monochrome (MonochromeCMS, a small reader with a JSON API at api.<site>: Monochrome Scans).
// Ported from Keiyoushi's MonochromeCMS (lib-multisrc/monochrome in github.com/keiyoushi/extensions-source,
// Apache-2.0): its series list and search, chapter list, cover and page images.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   apiUrl   the API ("https://api.<site>")
//
// Page images are /media/<series id>/<chapter id>/<n>.jpg; Keiyoushi's path without the series id now answers 404.
//
// @theme monochrome
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var API = String(SITE.apiUrl || BASE.replace('://', '://api.')).replace(/\/+$/, '');
var PER_PAGE = 10;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function api(path) {
  var res = await fetch(API + path, { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE + '/' } });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) throw new Error(SITE.name + ' answered ' + res.status + '.');
  return res.json();
}

/* ── titles ───────────────────────────────────────────────────────────── */

function titleUrl(id) {
  return BASE + '/manga/' + id;
}

function idOf(url) {
  var match = /\/manga\/([0-9a-f-]{36})/i.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return match[1];
}

function coverOf(series) {
  return API + '/media/' + series.id + '/cover.jpg?version=' + (series.version || 1);
}

function statusOf(text) {
  var status = String(text || '').toLowerCase();
  if (status === 'ongoing') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return null;
}

function toItem(series) {
  return { title: String(series.title || '').trim(), url: titleUrl(series.id), cover: coverOf(series), status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

/** The API's list: `{ offset, limit, results, total }`, 10 a page, searched by title. */
async function list(pageNumber, title) {
  var offset = PER_PAGE * ((pageNumber || 1) - 1);
  var body = await api('/manga?limit=' + PER_PAGE + '&offset=' + offset + '&title=' + encodeURIComponent(title || ''));
  var results = body.results || [];
  return { items: results.filter(function (series) { return series.id; }).map(toItem), hasNextPage: Number(body.total) > offset + results.length };
}

async function popular(options) {
  return list((options && options.page) || 1, '');
}

async function search(text, pageNumber) {
  return list(pageNumber || 1, String(text || '').trim());
}

/* ── details ──────────────────────────────────────────────────────────── */

function chapterNumber(number) {
  return String(Math.round(Number(number) * 100) / 100);
}

/** One per number, oldest first. The chapter link carries what the page images need after `#`. */
function chaptersOf(seriesId, rows) {
  var seen = {};
  var out = [];
  (rows || []).forEach(function (chapter) {
    var number = Number(chapter.number);
    if (!isFinite(number) || seen[number] || !chapter.id) return;
    seen[number] = true;
    var name = String(chapter.name || '').trim();
    out.push({
      url: BASE + '/chapters/' + chapter.id + '#' + [seriesId, chapter.version || 1, chapter.length || 0].join('|'),
      title: (chapter.volume !== null && chapter.volume !== undefined ? 'Vol ' + chapter.volume + ' ' : '') + 'Chapter ' + chapterNumber(number) + (name ? ' - ' + name : ''),
      number: number,
      date: chapter.uploadTime ? new Date(chapter.uploadTime).toISOString() : null,
    });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var id = idOf(url);
  var series = await api('/manga/' + id);
  var chapters = chaptersOf(id, await api('/manga/' + id + '/chapters'));
  var description = String(series.description || '').trim();
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var people = [series.author, series.artist].map(function (name) { return String(name || '').trim(); }).filter(Boolean);
  return {
    title: String(series.title || '').trim(),
    cover: coverOf(series),
    description: description,
    status: statusOf(series.status),
    authors: people.filter(function (name, i) { return people.indexOf(name) === i; }),
    year: series.year ? Number(series.year) || null : null,
    chapters: chapters,
  };
}

async function getChapters(url) {
  var id = idOf(url);
  return chaptersOf(id, await api('/manga/' + id + '/chapters'));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** ".../chapters/<chapter id>#<series id>|<version>|<page count>": the pages are numbered 1…count. */
async function getPages(url) {
  var match = /\/chapters\/([0-9a-f-]{36})#([0-9a-f-]{36})\|(\d+)\|(\d+)$/i.exec(String(url));
  if (!match) throw new Error('Open the title again to refresh its chapters.');
  var count = Number(match[4]);
  if (!count) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  var pages = [];
  for (var n = 1; n <= count; n++) {
    pages.push({ url: API + '/media/' + match[2] + '/' + match[1] + '/' + n + '.jpg?version=' + match[3], headers: { Referer: BASE + '/', 'User-Agent': AGENT } });
  }
  return pages;
}
