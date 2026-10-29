// SilentQuill's Next.js reader.
// Ported from Keiyoushi's SilentQuill source (src/en/silentquill in
// github.com/keiyoushi/extensions-source, Apache-2.0): RSC lists/search and
// reader pages, plus the title page's metadata and chapter list.
//
// @theme silentquill
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var IMAGE_HEADERS = { Referer: BASE + '/', 'User-Agent': AGENT };
var MAX_URL_BYTES = 150;

// @include lib/html.js

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url, extra) {
  var headers = { 'User-Agent': AGENT, Referer: BASE + '/' };
  for (var key in extra || {}) headers[key] = extra[key];
  var res = await fetch(url, { headers: headers });
  if (res.status === 404) throw new Error('SilentQuill no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error('SilentQuill wants a browser check. Open the site in Otavue, then try again.');
    throw new Error('SilentQuill answered ' + res.status + '.');
  }
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error('SilentQuill no longer has this.');
  return res;
}

function absolute(path) {
  if (!path) return null;
  try { return new URL(path, BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return null; }
}

function query(values) {
  return values.filter(function (pair) { return pair[1] !== '' && pair[1] !== null && pair[1] !== undefined; })
    .map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

/* React Server Components rows. Text rows use a UTF-8 byte length and can contain newlines. */
function byteEnd(text, start, bytes) {
  var i = start;
  while (bytes > 0 && i < text.length) {
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { bytes -= 4; i += 2; } else { bytes -= code < 0x80 ? 1 : code < 0x800 ? 2 : 3; i += 1; }
  }
  return i;
}

function rscRows(text) {
  var rows = {};
  var i = 0;
  while (i < text.length) {
    var colon = text.indexOf(':', i);
    if (colon < 0) break;
    var id = text.slice(i, colon).replace(/^\s+/, '');
    var textRow = /^T([0-9a-f]+),/.exec(text.slice(colon + 1, colon + 20));
    if (textRow) {
      var start = colon + 1 + textRow[0].length;
      var end = byteEnd(text, start, parseInt(textRow[1], 16));
      rows[id] = text.slice(start, end);
      i = end;
      continue;
    }
    var newline = text.indexOf('\n', colon);
    if (newline < 0) newline = text.length;
    var body = text.slice(colon + 1, newline);
    if (body[0] === '{' || body[0] === '[' || body[0] === '"') {
      try { rows[id] = JSON.parse(body); } catch (e) { /* not a complete JSON row */ }
    }
    i = newline + 1;
  }
  return rows;
}

function resolved(value, rows, levels) {
  if (typeof value === 'string') {
    // `$L<id>` is a lazy component row; its value is still ordinary JSON once streamed.
    var ref = /^\$(?:L)?([0-9a-f]+)$/.exec(value);
    return ref && rows[ref[1]] !== undefined ? resolved(rows[ref[1]], rows, levels) : value;
  }
  if (!value || typeof value !== 'object' || levels <= 0) return value;
  var out = Array.isArray(value) ? [] : {};
  for (var key in value) out[key] = resolved(value[key], rows, levels - 1);
  return out;
}

async function rsc(url) {
  var res = await request(url, { rsc: '1', Accept: 'text/x-component' });
  return rscRows(String(await res.text()));
}

function findRsc(rows, test) {
  var found = null;
  var walk = function (value, depth) {
    if (found || !value || typeof value !== 'object' || depth > 45) return;
    var shallow = resolved(value, rows, 2);
    if (!Array.isArray(shallow) && test(shallow)) { found = resolved(value, rows, 18); return; }
    for (var key in value) walk(value[key], depth + 1);
  };
  for (var id in rows) { walk(rows[id], 0); if (found) break; }
  return found;
}

function contains(root, test) {
  var found = null;
  var walk = function (value) {
    if (found || !value || typeof value !== 'object') return;
    if (test(value)) { found = value; return; }
    for (var key in value) walk(value[key]);
  };
  walk(root);
  return found;
}

function byteLength(text) { return unescape(encodeURIComponent(text)).length; }

function linkOf(href, id) {
  var full = absolute(href);
  if (!full || byteLength(full) <= MAX_URL_BYTES || !id) return full;
  var prefix = BASE + '/series/';
  var slug = String(href).replace(/^\/series\//, '').replace(/\/+$/, '');
  var room = MAX_URL_BYTES - byteLength(prefix + '#' + id);
  var short = slug.slice(0, Math.max(room, 1));
  if (short.indexOf('-') > 0) short = short.slice(0, short.lastIndexOf('-'));
  return prefix + short + '#' + id;
}

function cardsOf(root) {
  var out = [];
  var seen = {};
  var walk = function (value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value) && value.length > 3 && value[3] && typeof value[3] === 'object') {
      var props = value[3];
      if (/^\/series\/[^\/]+\/?$/.test(String(props.href || ''))) {
        var image = contains(props, function (x) { return typeof x.src === 'string' && typeof x.alt === 'string'; });
        var url = linkOf(props.href, value[2]);
        if (image && image.alt && url && !seen[url]) {
          seen[url] = true;
          out.push({ title: String(image.alt).trim(), url: url, cover: absolute(image.src), coverHeaders: IMAGE_HEADERS });
        }
      }
    }
    for (var key in value) walk(value[key]);
  };
  walk(root);
  return out;
}

function gridOf(rows, popularGrid) {
  return findRsc(rows, function (x) {
    var classes = String(x.className || '');
    return popularGrid ? classes.indexOf('grid-cols-4') >= 0 && classes.indexOf('md:grid-cols-8') >= 0
      : classes.indexOf('grid-cols-2') >= 0 && classes.indexOf('lg:grid-cols-6') >= 0;
  });
}

async function popular(options) {
  if (options && options.page > 1) return { items: [], hasNextPage: false };
  var rows = await rsc(BASE + '/');
  return { items: cardsOf(gridOf(rows, true)), hasNextPage: false };
}

async function search(text, page, options) {
  page = page || 1;
  var filters = (options && options.filters) || {};
  var url = BASE + '/search/?' + query([['status', filters.status], ['genre', filters.genre], ['q', String(text || '').trim()], ['page', page]]);
  var rows = await rsc(url);
  var grid = gridOf(rows, false);
  var next = false;
  var wanted = 'page=' + (page + 1);
  for (var id in rows) {
    var hit = contains(resolved(rows[id], rows, 10), function (x) { return typeof x.href === 'string' && x.href.indexOf(wanted) >= 0; });
    if (hit) { next = true; break; }
  }
  return { items: cardsOf(grid), hasNextPage: next };
}

async function latest(options) { return search('', (options && options.page) || 1, {}); }

async function getFilters() {
  var rows = await rsc(BASE + '/search/?q=&page=1');
  var picker = findRsc(rows, function (x) { return x.label === 'Genre' && Array.isArray(x.options); });
  var genres = ((picker && picker.options) || []).filter(function (row) { return row && row.value; }).map(function (row) {
    return { value: row.value, label: String(row.label || row.value).replace(/\s*\(\d+\)\s*$/, '') };
  });
  return [
    { type: 'select', key: 'status', name: 'Status', options: [
      { value: '', label: 'All' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' },
    ], default: '' },
    { type: 'select', key: 'genre', name: 'Genre', options: [{ value: '', label: 'All' }].concat(genres), default: '' },
  ];
}

function seriesParts(url) {
  var match = /\/series\/([^\/?#]+)\/?(?:#([^\/?#]+))?$/.exec(String(url || ''));
  return match ? { slug: decodeURIComponent(match[1]), id: match[2] || null } : null;
}

async function fullSeriesUrl(url) {
  var parts = seriesParts(url);
  if (!parts) throw new Error('That isn’t a SilentQuill title link.');
  if (!parts.id) return BASE + '/series/' + parts.slug + '/';
  var words = parts.slug.split('-').filter(Boolean).slice(0, 5).join(' ');
  var rows = await rsc(BASE + '/search/?' + query([['q', words], ['page', 1]]));
  var full = null;
  var walk = function (value) {
    if (full || !value || typeof value !== 'object') return;
    if (Array.isArray(value) && String(value[2]) === parts.id && value[3] && /^\/series\/[^\/]+\/?$/.test(String(value[3].href || ''))) full = absolute(value[3].href);
    for (var key in value) walk(value[key]);
  };
  for (var id in rows) { walk(resolved(rows[id], rows, 18)); if (full) break; }
  if (!full) throw new Error('SilentQuill no longer has this.');
  return full;
}

function statusOf(text) {
  text = String(text || '').toLowerCase();
  if (text.indexOf('ongoing') >= 0) return 'ongoing';
  if (text.indexOf('complete') >= 0) return 'completed';
  if (text.indexOf('hiatus') >= 0) return 'hiatus';
  if (/drop|cancel/.test(text)) return 'cancelled';
  return null;
}

function chaptersOf(doc, seriesSlug) {
  var seen = {};
  return all(doc, 'div[tabindex] a[href]').map(function (link) {
    var href = attr(link, 'href');
    if (!/(?:chapter|ch)-?\d/i.test(href)) return null;
    var label = textOf(first(link, 'span')) || textOf(link);
    var number = numberOf(label, href);
    if (number === null || seen[number]) return null;
    seen[number] = true;
    var spans = all(link, 'span');
    var age = spans.length > 1 ? textOf(spans[spans.length - 1]) : '';
    var chapterSlug = href.replace(/^\/+|\/+$/g, '');
    return {
      url: BASE + '/series/' + seriesSlug + '/' + chapterSlug + '/',
      title: 'Chapter ' + number,
      number: number,
      date: /^\d+\s+[a-z]+s?$/i.test(age) ? dateOf(age + ' ago') : dateOf(age),
    };
  }).filter(Boolean).sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var full = await fullSeriesUrl(url);
  var parts = seriesParts(full);
  var res = await request(full, { Accept: 'text/html' });
  var doc = parseHtml(await res.text());
  var title = textOf(first(doc, 'main h1'));
  if (!title) throw new Error('That isn’t a SilentQuill title.');
  var authorLine = textOf(first(doc, 'main p.mt-2.text-sm.text-ink-dim'));
  var authors = authorLine.split(/\s*·\s*(?:art by\s*)?/i).map(function (name) { return name.trim(); }).filter(function (name, i, list) { return name && list.indexOf(name) === i; });
  var statusTerm = first(doc, 'main dt:containsOwn(Status)');
  var chapters = chaptersOf(doc, parts.slug);
  var description = textOf(first(doc, 'main .reader-content'));
  if (!chapters.length) description = 'No chapters are available on SilentQuill right now.' + (description ? '\n\n' + description : '');
  return {
    title: title,
    cover: absolute(attr(first(doc, 'main img[src^=/img/]'), 'src')),
    coverHeaders: IMAGE_HEADERS,
    description: description,
    status: statusOf(textOf(statusTerm ? first(statusTerm.parent, 'dd') : null)),
    genres: all(doc, 'main a[href^="/search/?genre="]').map(textOf).filter(Boolean),
    authors: authors,
    chapters: chapters,
  };
}

async function getChapters(url) { return (await getDetail(url)).chapters; }

async function getPages(url) {
  var rows = await rsc(String(url).split('#')[0]);
  var viewer = findRsc(rows, function (x) { return Array.isArray(x.pages) && x.pages.length > 0 && x.pages[0] && typeof x.pages[0].url === 'string'; });
  if (!viewer) throw new Error('SilentQuill did not return this chapter’s pages.');
  return viewer.pages.map(function (page) {
    return { url: absolute(page.url), width: page.width || undefined, height: page.height || undefined, headers: IMAGE_HEADERS };
  }).filter(function (page) { return page.url; });
}
