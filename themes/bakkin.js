// Bakkin Reader X (a small reader whose whole library is one JSON file, main.php: Bakkin).
// Ported from Keiyoushi's BakkinReaderX (lib-multisrc/bakkin in github.com/keiyoushi/extensions-source, Apache-2.0):
// its series, volume and chapter folders, page paths and reader links.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file, one copy per site (baseUrl ends in "/").
//
// Chapter folders are named "c012" for chapter 12; covers, bonus chapters and afterwords have other names. Where a
// series' numbers don't repeat, those extras are numbered just after the chapter before them (12.01, 12.02, …), so
// nothing is lost; a collection whose numbers repeat (each anthology starts again at 1) is numbered in reading order.
//
// @theme bakkin
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/*$/, '/');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// @include lib/html.js

/* ── the library ──────────────────────────────────────────────────────── */

async function library() {
  var res = await fetch(BASE + 'main.php', { headers: { 'User-Agent': AGENT, Accept: 'application/json', Referer: BASE } });
  if (!res.ok) throw new Error(SITE.name + ' answered ' + res.status + '.');
  var body = await res.json();
  return Object.keys(body || {}).map(function (key) { return body[key]; }).filter(function (series) { return series && series.dir; });
}

async function seriesFor(dir) {
  var all = await library();
  for (var i = 0; i < all.length; i++) if (all[i].dir === dir) return all[i];
  throw new Error(SITE.name + ' no longer has this.');
}

function nameOf(entry) {
  return String(entry.name || '').trim() || entry.dir;
}

/** Reader links: "<site>#m=<series>" and "#m=<series>&v=<volume>&c=<chapter>". */
function linkPart(url, key) {
  var match = new RegExp('[#&]' + key + '=([^&]+)').exec(String(url));
  return match ? decodeURIComponent(match[1]) : '';
}

function statusOf(text) {
  var value = String(text || '').toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'completed') return 'completed';
  return null;
}

function toItem(series) {
  return { title: nameOf(series), url: BASE + '#m=' + series.dir, cover: BASE + (series.thumb || 'static/nocover.png'), status: statusOf(series.status) };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function popular() {
  return { items: (await library()).map(toItem), hasNextPage: false };
}

async function search(text) {
  var query = String(text || '').trim().toLowerCase();
  var all = await library();
  return { items: all.filter(function (series) { return nameOf(series).toLowerCase().indexOf(query) >= 0; }).map(toItem), hasNextPage: false };
}

/* ── details ──────────────────────────────────────────────────────────── */

/** Every chapter in reading order, with a number that's unique within the series (see the top of this file). */
function chaptersOf(series) {
  var rows = [];
  (series.volumes || []).forEach(function (volume) {
    (volume.chapters || []).forEach(function (chapter) {
      var match = /c(\d+(?:\.\d+)?)$/i.exec(chapter.dir);
      rows.push({ volume: volume, chapter: chapter, real: match ? Number(match[1]) : null });
    });
  });
  var reals = rows.filter(function (row) { return row.real !== null; }).map(function (row) { return row.real; });
  var repeats = reals.some(function (n, i) { return reals.indexOf(n) !== i; });
  var previous = 0;
  var extra = 0;
  return rows.map(function (row, index) {
    var number;
    if (repeats) number = index + 1;
    else if (row.real !== null) { number = row.real; previous = row.real; extra = 0; }
    else { extra += 1; number = Math.round((previous + extra / 100) * 100) / 100; }
    return {
      url: BASE + '#m=' + series.dir + '&v=' + row.volume.dir + '&c=' + row.chapter.dir,
      title: nameOf(row.volume) + ' - ' + nameOf(row.chapter),
      number: number,
      date: null,
    };
  }).filter(function (chapter, i, all) {
    return all.findIndex(function (other) { return other.number === chapter.number; }) === i;
  }).sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var series = await seriesFor(linkPart(url, 'm'));
  var chapters = chaptersOf(series);
  var description = series.latest_name ? 'Latest: ' + series.latest_name + (series.latest_time ? ' (' + series.latest_time + ')' : '') : '';
  if (series.buy_from && series.buy_link) description = (description ? description + '\n\n' : '') + 'Buy it from ' + series.buy_from + ': ' + series.buy_link;
  return {
    title: nameOf(series),
    cover: BASE + (series.thumb || 'static/nocover.png'),
    description: description,
    status: statusOf(series.status),
    authors: series.author ? [String(series.author).trim()] : [],
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(await seriesFor(linkPart(url, 'm')));
}

/* ── pages ────────────────────────────────────────────────────────────── */

async function getPages(url) {
  var series = await seriesFor(linkPart(url, 'm'));
  var volumeDir = linkPart(url, 'v');
  var chapterDir = linkPart(url, 'c');
  var volume = (series.volumes || []).filter(function (one) { return one.dir === volumeDir; })[0];
  var chapter = volume && (volume.chapters || []).filter(function (one) { return one.dir === chapterDir; })[0];
  if (!chapter) throw new Error(SITE.name + ' no longer has this chapter.');
  var pages = (chapter.pages || []).filter(Boolean);
  if (pages.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return pages.map(function (path) {
    return { url: /^https?:\/\//.test(path) ? path : BASE + String(path).replace(/^\/+/, ''), headers: { Referer: BASE, 'User-Agent': AGENT } };
  });
}
