// Madara (the WordPress "WP-Manga" theme many scanlation sites run).
// Ported from Keiyoushi's Madara (lib-multisrc/madara in github.com/keiyoushi/extensions-source,
// Apache-2.0): its list requests (`madara_load_more`), selectors, chapter endpoints, status words and dates.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   mangaPath     where titles live ("manga")           genrePath   genre archive path ("manga-genre")
//   browse        "ajax" (madara_load_more) or "archive" (plain list pages)
//   ajaxTemplate  madara_load_more's template           mangaOnly   only list "manga"-type posts (true)
//   chapters      "auto", "page", "ajax", "admin" or "paged"
//   dateFormat    e.g. "MMMM d, yyyy", "MM/dd/yyyy"     adult       keep titles the site marks 18+ (false)
//   selectors     overrides for SELECTORS below         cookie      a Cookie header some sites need
//   imageReferer  "site" to send the site, not the chapter, as page images' Referer
//
// @theme madara
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var MANGA_PATH = SITE.mangaPath || 'manga';
var GENRE_PATH = SITE.genrePath || 'manga-genre';
var PAGE_SIZE = 25;
// Otavue keys a title by its URL (base64url, at most 200 characters), so longer ones fall back to `/?p=<id>`.
var MAX_URL_BYTES = 150;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };

var SELECTORS = {
  item: 'div.page-item-detail, .manga__item, .c-tabs-item__content',
  itemLink: '.post-title a',
  itemTitle: null,
  next: 'div.nav-previous, a.nextpostslink, #navigation-ajax, .wp-pagenavi a.nextpostslink, a.next',
  title: 'div.post-title h3, div.post-title h1, #manga-title > h1',
  author: 'div.author-content > a, div.manga-authors > a',
  artist: 'div.artist-content > a',
  status: 'div.summary-content, div.summary-heading:contains(Status) + div',
  description: 'div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt',
  cover: 'div.summary_image img',
  genre: 'div.genres-content a',
  tag: 'div.tags-content a',
  type: '.post-content_item:contains(Type) .summary-content',
  alt: '.post-content_item:contains(Alt) .summary-content',
  chapter: 'li.wp-manga-chapter',
  chapterLink: 'a',
  chapterName: null,
  chapterDate: 'span.chapter-release-date',
  pages: 'div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item))',
  genreList: 'div.genres',
};
(function () {
  var overrides = SITE.selectors || {};
  for (var key in overrides) SELECTORS[key] = overrides[key];
})();

/* ── HTML ─────────────────────────────────────────────────────────────── */
// A small, forgiving HTML parser and CSS selector engine, so the same code runs in Otavue's
// WebView and in Node tests. Selectors: tag, #id, .class, [attr], [attr=|^=|$=|*=|~=value],
// :not(), :has(), :contains() (Jsoup's), :first-child, and the " ", ">", "+", "~" combinators.

var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
var RAW = { script: 1, style: 1, textarea: 1, title: 1 };
var BLOCK = { address: 1, article: 1, aside: 1, blockquote: 1, div: 1, dl: 1, fieldset: 1, footer: 1, form: 1, h1: 1, h2: 1, h3: 1, h4: 1,
  h5: 1, h6: 1, header: 1, hr: 1, main: 1, nav: 1, ol: 1, p: 1, pre: 1, section: 1, table: 1, ul: 1 };
var SIBLING_CLOSE = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'] };
var TAG_RE = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s\/>]*)[^>]*>|<([a-zA-Z][^\s\/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
var ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', times: '×' };

function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (whole, name) {
    if (name[0] === '#') {
      var code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    var named = NAMED[name.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function parseHtml(html) {
  html = String(html || '');
  var root = { tag: '#root', attrs: {}, children: [], parent: null };
  var stack = [root];
  var top = function () { return stack[stack.length - 1]; };
  var addText = function (text) { if (text) top().children.push({ text: text, parent: top() }); };
  var closeTo = function (tag, stopAt) {
    for (var i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) { stack.length = i; return; }
      if (stopAt && stopAt[stack[i].tag]) return;
    }
  };
  var last = 0;
  var match;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(html))) {
    if (match.index > last) addText(html.slice(last, match.index));
    last = TAG_RE.lastIndex;
    if (match[1]) { closeTo(match[1].toLowerCase()); continue; }
    if (!match[2]) continue;
    var tag = match[2].toLowerCase();
    var raw = match[3] || '';
    var attrs = {};
    ATTR_RE.lastIndex = 0;
    var a;
    while ((a = ATTR_RE.exec(raw))) {
      var name = a[1].toLowerCase();
      if (name === '/' || attrs[name] !== undefined) continue;
      attrs[name] = decodeEntities(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '');
    }
    if (BLOCK[tag] && top().tag === 'p') stack.pop();
    var siblings = SIBLING_CLOSE[tag];
    if (siblings) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (siblings.indexOf(stack[i].tag) >= 0) { stack.length = i; break; }
        if (/^(ul|ol|dl|select|table|tbody|thead|tr)$/.test(stack[i].tag)) break;
      }
    }
    var el = { tag: tag, attrs: attrs, children: [], parent: top() };
    top().children.push(el);
    if (RAW[tag]) {
      var end = html.toLowerCase().indexOf('</' + tag, last);
      if (end < 0) end = html.length;
      if (end > last) el.children.push({ text: html.slice(last, end), parent: el, raw: true });
      var close = html.indexOf('>', end);
      last = TAG_RE.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!VOID[tag] && !/\/\s*$/.test(raw)) stack.push(el);
  }
  if (last < html.length) addText(html.slice(last));
  return root;
}

var selectorCache = {};

/** `a, b` → groups; each group is [{ combinator, compound }] read left to right. */
function parseSelector(selector) {
  if (selectorCache[selector]) return selectorCache[selector];
  var groups = [];
  var parts = [];
  var combinator = ' ';
  var i = 0;
  var s = selector;
  var readUntilClose = function () {
    var depth = 1;
    var start = i;
    var quote = null;
    while (i < s.length) {
      var c = s[i];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '(') depth++; else if (c === ')' && --depth === 0) break;
      i++;
    }
    var inner = s.slice(start, i);
    i++;
    return inner;
  };
  var ident = function () {
    var m = /^(?:\\.|[\w -￿-])+/.exec(s.slice(i));
    if (!m) return '';
    i += m[0].length;
    return m[0].replace(/\\(.)/g, '$1');
  };
  var compound = null;
  var flush = function () {
    if (compound) parts.push({ combinator: combinator, compound: compound });
    compound = null;
  };
  var current = function () { return compound || (compound = { tag: null, id: null, classes: [], attrs: [], pseudos: [] }); };
  while (i < s.length) {
    var c = s[i];
    if (/\s/.test(c)) {
      i++;
      if (compound) { flush(); combinator = ' '; }
      continue;
    }
    if (c === ',') {
      flush();
      if (parts.length) groups.push(parts);
      parts = [];
      combinator = ' ';
      i++;
      continue;
    }
    if (c === '>' || c === '+' || c === '~') {
      flush();
      combinator = c;
      i++;
      continue;
    }
    if (c === '*') { current(); i++; continue; }
    if (c === '#') { i++; current().id = ident(); continue; }
    if (c === '.') { i++; current().classes.push(ident()); continue; }
    if (c === '[') {
      var end = s.indexOf(']', i);
      var body = s.slice(i + 1, end);
      i = end + 1;
      var m = /^\s*([^\s~|^$*!=]+)\s*(?:([~|^$*!]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*$/.exec(body);
      if (m) current().attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] });
      continue;
    }
    if (c === ':') {
      i++;
      var name = ident().toLowerCase();
      var arg = null;
      if (s[i] === '(') { i++; arg = readUntilClose(); }
      if (arg !== null && /^["'].*["']$/.test(arg.trim())) arg = arg.trim().slice(1, -1);
      current().pseudos.push({ name: name, arg: arg });
      continue;
    }
    current().tag = ident().toLowerCase();
  }
  flush();
  if (parts.length) groups.push(parts);
  selectorCache[selector] = groups;
  return groups;
}

var isElement = function (node) { return node && node.tag && node.tag !== '#root'; };

function previousElement(el) {
  if (!el.parent) return null;
  var list = el.parent.children;
  for (var i = list.indexOf(el) - 1; i >= 0; i--) if (list[i].tag) return list[i];
  return null;
}

function matchesCompound(el, c) {
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    var classes = ' ' + (el.attrs['class'] || '').replace(/\s+/g, ' ') + ' ';
    for (var i = 0; i < c.classes.length; i++) if (classes.indexOf(' ' + c.classes[i] + ' ') < 0) return false;
  }
  for (var j = 0; j < c.attrs.length; j++) {
    var at = c.attrs[j];
    var value = el.attrs[at.name];
    if (value === undefined) return false;
    if (!at.op) continue;
    var want = at.value;
    if (at.op === '=' && value !== want) return false;
    if (at.op === '^=' && (!want || value.indexOf(want) !== 0)) return false;
    if (at.op === '$=' && (!want || value.slice(-want.length) !== want)) return false;
    if (at.op === '*=' && (!want || value.indexOf(want) < 0)) return false;
    if (at.op === '~=' && (' ' + value + ' ').indexOf(' ' + want + ' ') < 0) return false;
    if (at.op === '!=' && value === want) return false;
  }
  for (var k = 0; k < c.pseudos.length; k++) {
    var p = c.pseudos[k];
    if (p.name === 'not' && matches(el, p.arg)) return false;
    if (p.name === 'has' && !first(el, p.arg)) return false;
    if (p.name === 'contains' && textOf(el).toLowerCase().indexOf(String(p.arg).toLowerCase()) < 0) return false;
    if (p.name === 'first-child' && previousElement(el)) return false;
  }
  return true;
}

function matchesFrom(el, parts, index) {
  if (!matchesCompound(el, parts[index].compound)) return false;
  if (index === 0) return true;
  var combinator = parts[index].combinator;
  if (combinator === '>') return isElement(el.parent) && matchesFrom(el.parent, parts, index - 1);
  if (combinator === '+') {
    var prev = previousElement(el);
    return Boolean(prev) && matchesFrom(prev, parts, index - 1);
  }
  if (combinator === '~') {
    for (var sib = previousElement(el); sib; sib = previousElement(sib)) if (matchesFrom(sib, parts, index - 1)) return true;
    return false;
  }
  for (var up = el.parent; isElement(up); up = up.parent) if (matchesFrom(up, parts, index - 1)) return true;
  return false;
}

function matches(el, selector) {
  var groups = parseSelector(selector);
  for (var i = 0; i < groups.length; i++) if (matchesFrom(el, groups[i], groups[i].length - 1)) return true;
  return false;
}

/** Every element under `node` matching `selector`, in document order. */
function all(node, selector) {
  var out = [];
  if (!node || !selector) return out;
  var groups = parseSelector(selector);
  var walk = function (parent) {
    for (var i = 0; i < parent.children.length; i++) {
      var child = parent.children[i];
      if (!child.tag) continue;
      for (var g = 0; g < groups.length; g++) {
        if (matchesFrom(child, groups[g], groups[g].length - 1)) { out.push(child); break; }
      }
      walk(child);
    }
  };
  walk(node);
  return out;
}

function first(node, selector) {
  return all(node, selector)[0] || null;
}

function clean(text) {
  return decodeEntities(text).replace(/[\s ]+/g, ' ').trim();
}

/** All the text inside an element (scripts and styles left out), whitespace collapsed. */
function textOf(node) {
  if (!node) return '';
  var parts = [];
  var walk = function (n) {
    if (n.text !== undefined) { if (!n.raw) parts.push(n.text); return; }
    if (n.tag === 'script' || n.tag === 'style') return;
    if (n.tag === 'br') parts.push(' ');
    for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  };
  walk(node);
  return clean(parts.join(''));
}

/** The element's own text, not its children's. */
function ownText(node) {
  if (!node) return '';
  return clean(node.children.filter(function (n) { return n.text !== undefined; }).map(function (n) { return n.text; }).join(' '));
}

function attr(node, name) {
  return node && node.attrs[name] !== undefined ? node.attrs[name] : '';
}

function rawText(node) {
  return node ? node.children.map(function (n) { return n.text || ''; }).join('') : '';
}

/* ── requests ─────────────────────────────────────────────────────────── */

function headers(extra) {
  var out = { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: BASE + '/' };
  if (SITE.cookie) out.Cookie = SITE.cookie;
  for (var key in extra || {}) out[key] = extra[key];
  return out;
}

async function request(url, options) {
  options = options || {};
  var res = await fetch(url, { method: options.method || 'GET', headers: headers(options.headers), body: options.body });
  if (res.ok || (options.allow && options.allow.indexOf(res.status) >= 0)) return res;
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
  }
  throw new Error(SITE.name + ' answered ' + res.status + '.');
}

async function page(url, options) {
  var res = await request(url, options);
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  return doc;
}

function form(fields) {
  return fields.map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]); }).join('&');
}

var AJAX_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: '*/*' };

function post(url, fields, allow) {
  return page(url, { method: 'POST', headers: AJAX_HEADERS, body: form(fields), allow: allow });
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : '';
}

/* ── titles ───────────────────────────────────────────────────────────── */

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

/** The title's link without query or fragment; `/?p=<id>` when it's too long to be Otavue's key. */
function titleUrl(href, postId) {
  var url = absolute(href).replace(/[?#].*$/, '');
  if (url && byteLength(url) <= MAX_URL_BYTES) return url;
  return postId ? BASE + '/?p=' + postId : url;
}

/** The best image in an <img>: lazy-load attributes first, then the largest srcset entry, then src. */
function imageOf(img, base) {
  if (!img) return null;
  var lazy = ['data-src', 'data-lazy-src', 'data-lzl-src', 'data-cfsrc', 'data-manga-src'];
  for (var i = 0; i < lazy.length; i++) {
    var value = attr(img, lazy[i]).trim();
    if (value) return absolute(value, base) || null;
  }
  var srcset = attr(img, 'data-srcset') || attr(img, 'srcset');
  if (srcset) {
    var best = null;
    srcset.split(',').forEach(function (candidate) {
      var bits = candidate.trim().split(/\s+/);
      var size = parseFloat(bits[1]) || 0;
      if (/^https?:\/\//.test(bits[0]) && (!best || size > best.size)) best = { url: bits[0], size: size };
    });
    if (best) return best.url;
  }
  var src = attr(img, 'src').trim();
  if (!src || /^data:/.test(src) || /dflazy|placeholder/.test(src)) return null;
  return absolute(src, base) || null;
}

function postIdOf(el) {
  var holder = el.attrs['data-post-id'] ? el : first(el, '[data-post-id]');
  return attr(holder, 'data-post-id') || null;
}

function itemsOf(doc) {
  var blocks = all(doc, SELECTORS.item);
  var items = [];
  var seen = {};
  blocks.forEach(function (block) {
    var link = first(block, SELECTORS.itemLink);
    if (!link || !attr(link, 'href')) return;
    var url = titleUrl(attr(link, 'href'), postIdOf(block));
    var title = SELECTORS.itemTitle ? textOf(first(block, SELECTORS.itemTitle)) : textOf(link) || attr(link, 'title');
    if (!url || !title || seen[url]) return;
    // The "18+" badge on a card, for lists the request itself can't filter.
    if (!SITE.adult && first(block, '.manga-title-badges.adult')) return;
    seen[url] = true;
    items.push({ title: title, url: url, cover: imageOf(first(block, 'img')), coverHeaders: COVER_HEADERS });
  });
  return { items: items, count: blocks.length };
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [
  ['', 'Relevance'],
  ['latest', 'Latest update'],
  ['alphabet', 'A–Z'],
  ['rating', 'Rating'],
  ['trending', 'Trending'],
  ['views', 'Most views'],
  ['new-manga', 'Newest'],
];
var STATUSES = [['end', 'Completed'], ['on-going', 'Ongoing'], ['canceled', 'Cancelled'], ['on-hold', 'On hold']];

function sortFields(sort) {
  var byMeta = function (key) { return [['vars[orderby]', 'meta_value_num'], ['vars[meta_key]', key], ['vars[order]', 'DESC']]; };
  switch (sort) {
    case 'latest': return byMeta('_latest_update');
    case 'views': return byMeta('_wp_manga_views');
    case 'trending': return byMeta('_wp_manga_week_views_value');
    case 'alphabet': return [['vars[orderby]', 'post_title'], ['vars[order]', 'ASC']];
    case 'new-manga': return [['vars[orderby]', 'date'], ['vars[order]', 'DESC']];
    case 'rating':
      return [
        ['vars[meta_query][query_average_reviews][key]', '_manga_avarage_reviews'],
        ['vars[meta_query][query_average_reviews][compare]', 'EXISTS'],
        ['vars[meta_query][query_total_reviews][key]', '_manga_total_votes'],
        ['vars[meta_query][query_total_reviews][compare]', 'EXISTS'],
        ['vars[orderby][query_average_reviews]', 'DESC'],
        ['vars[orderby][query_total_reviews]', 'DESC'],
      ];
    default: return [];
  }
}

/** One page of `madara_load_more`, the list request Madara's own "load more" button makes. */
async function ajaxList(pageNumber, sort, query, filters) {
  filters = filters || {};
  var fields = [
    ['action', 'madara_load_more'],
    ['page', String(Math.max(0, (pageNumber || 1) - 1))],
    ['template', SITE.ajaxTemplate || 'madara-core/content/content-archive'],
    ['vars[paged]', '1'],
    ['vars[template]', 'archive'],
    ['vars[posts_per_page]', String(PAGE_SIZE)],
    ['vars[post_type]', 'wp-manga'],
    ['vars[post_status]', 'publish'],
    ['vars[manga_archives_item_layout]', 'big_thumbnail'],
  ];
  var meta = 0;
  if (SITE.mangaOnly !== false) {
    fields.push(['vars[meta_query][0][key]', '_wp_manga_chapter_type'], ['vars[meta_query][0][value]', 'manga']);
    meta = 1;
  }
  if (!SITE.adult) {
    // Sites store the flag on every title (empty, or a list holding "yes"), so "not marked yes" rather than "not set".
    var adult = 'vars[meta_query][' + meta + ']';
    fields.push(
      [adult + '[relation]', 'OR'],
      [adult + '[0][key]', 'manga_adult_content'], [adult + '[0][compare]', 'NOT EXISTS'],
      [adult + '[1][key]', 'manga_adult_content'], [adult + '[1][value]', 'yes'], [adult + '[1][compare]', 'NOT LIKE']
    );
    meta++;
  }
  if (query) fields.push(['vars[s]', query]);
  var statuses = [].concat(filters.status || []);
  if (statuses.length) {
    fields.push(['vars[meta_query][' + meta + '][key]', '_wp_manga_status'], ['vars[meta_query][' + meta + '][compare]', 'IN']);
    statuses.forEach(function (value, i) { fields.push(['vars[meta_query][' + meta + '][value][' + i + ']', value]); });
    meta++;
  }
  var genres = [].concat(filters.genres || []).filter(Boolean);
  if (genres.length) {
    fields.push(['vars[tax_query][0][taxonomy]', 'wp-manga-genre'], ['vars[tax_query][0][field]', 'slug']);
    genres.forEach(function (slug, i) { fields.push(['vars[tax_query][0][terms][' + i + ']', slug]); });
    if (filters.genreMode === 'and') fields.push(['vars[tax_query][0][operator]', 'AND']);
  }
  fields = fields.concat(sortFields(sort));
  var found = itemsOf(await post(BASE + '/wp-admin/admin-ajax.php', fields));
  return { items: found.items, hasNextPage: found.count >= PAGE_SIZE };
}

/** A plain list page: `/<mangaPath>/page/N/?m_orderby=…`, a genre's page, or the site search. */
async function archiveList(pageNumber, sort, path, query) {
  var url = BASE + (path || '/' + MANGA_PATH + '/');
  if (pageNumber > 1) url += 'page/' + pageNumber + '/';
  var params = [];
  if (query) params.push('s=' + encodeURIComponent(query), 'post_type=wp-manga');
  if (sort) params.push('m_orderby=' + encodeURIComponent(sort));
  if (params.length) url += '?' + params.join('&');
  var doc = await page(url);
  return { items: itemsOf(doc).items, hasNextPage: Boolean(first(doc, SELECTORS.next)) };
}

async function list(pageNumber, sort) {
  if (SITE.browse === 'archive') return archiveList(pageNumber, sort);
  return ajaxList(pageNumber, sort);
}

async function popular(options) {
  return list((options && options.page) || 1, 'views');
}

async function latest(options) {
  return list((options && options.page) || 1, 'latest');
}

async function search(query, pageNumber, options) {
  var filters = (options && options.filters) || {};
  // WordPress search misses curly quotes the site itself prints ("It’s"), so they go back to straight ones.
  query = String(query || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
  pageNumber = pageNumber || 1;
  if (SITE.browse === 'archive') {
    var genre = [].concat(filters.genres || [])[0];
    if (genre) return archiveList(pageNumber, filters.sort, '/' + GENRE_PATH + '/' + genre + '/', query);
    if (!query) return archiveList(pageNumber, filters.sort || 'views');
    return archiveList(pageNumber, '', '/', query);
  }
  return ajaxList(pageNumber, filters.sort || '', query, filters);
}

var genreCache = null;

/** The genres listed on the site's own manga page (`div.genres`). */
async function genresOf() {
  if (genreCache) return genreCache;
  var doc = await page(BASE + '/' + MANGA_PATH + '/');
  var seen = {};
  var out = [];
  all(doc, SELECTORS.genreList).forEach(function (box) {
    all(box, 'a[href*="/' + GENRE_PATH + '/"]').forEach(function (link) {
      var slug = /\/([^\/?#]+)\/?(?:[?#].*)?$/.exec(attr(link, 'href'));
      var name = ownText(link) || textOf(link).replace(/\s*\(?\d[\d,.]*\)?\s*$/, '');
      if (!slug || !name || seen[slug[1]]) return;
      seen[slug[1]] = true;
      out.push({ value: decodeURIComponent(slug[1]), label: name });
    });
  });
  genreCache = out;
  return out;
}

async function getFilters() {
  var genres = await genresOf().catch(function () { return []; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  if (SITE.browse === 'archive') {
    var filters = [{ type: 'select', key: 'sort', name: 'Order by', options: options(SORTS), default: '' }];
    if (genres.length) filters.push({ type: 'select', key: 'genres', name: 'Genre', options: [{ value: '', label: 'All' }].concat(genres), default: '' });
    return filters;
  }
  var out = [
    { type: 'select', key: 'sort', name: 'Order by', options: options(SORTS), default: '' },
    { type: 'multi', key: 'status', name: 'Status', options: options(STATUSES), default: [] },
  ];
  if (genres.length) {
    out.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
    out.push({ type: 'select', key: 'genreMode', name: 'Genres must match', options: options([['', 'Any of them'], ['and', 'All of them']]), default: '' });
  }
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

var STATUS_WORDS = [
  ['completed', /complete|completo|concluído|concluido|finalizado|finished|ended/i],
  ['cancelled', /cancel|dropped/i],
  ['hiatus', /on hold|hiatus|paused/i],
  ['ongoing', /ongoing|on going|updating|releasing|publishing/i],
  ['upcoming', /upcoming|coming soon/i],
];

function statusOf(text) {
  for (var i = 0; i < STATUS_WORDS.length; i++) if (STATUS_WORDS[i][1].test(text || '')) return STATUS_WORDS[i][0];
  return null;
}

var isUpdating = function (text) { return /updating/i.test(text); };

function unique(values) {
  var seen = {};
  return values.filter(function (value) {
    var key = value.toLowerCase();
    if (!value || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function descriptionOf(doc) {
  var box = first(doc, SELECTORS.description);
  if (!box) return '';
  var paragraphs = all(box, 'p').map(textOf).filter(Boolean);
  var text = paragraphs.length ? paragraphs.join('\n\n') : textOf(box);
  return text.replace(/\s*Show more\s*$/i, '').trim();
}

/** The title page, from its URL (a `/?p=<id>` link is followed to the real page). */
function titlePage(url) {
  return page(absolute(url));
}

async function getDetail(url) {
  var doc = await titlePage(url);
  var heading = first(doc, SELECTORS.title);
  var title = ownText(heading) || textOf(heading) || clean(attr(first(doc, 'meta[property="og:title"]'), 'content'));
  if (!title) throw new Error('That isn’t a ' + SITE.name + ' title page.');
  var description = descriptionOf(doc);
  var alt = ownText(first(doc, SELECTORS.alt)) || textOf(first(doc, SELECTORS.alt));
  if (alt && !isUpdating(alt)) description = (description ? description + '\n\n' : '') + 'Also known as: ' + alt;
  var statusBoxes = all(doc, SELECTORS.status);
  var type = textOf(first(doc, SELECTORS.type));
  var people = all(doc, SELECTORS.author).concat(all(doc, SELECTORS.artist)).map(textOf).filter(function (name) { return !isUpdating(name); });
  var chapters = await chaptersOf(doc);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  return {
    title: title,
    cover: imageOf(first(doc, SELECTORS.cover), doc.url),
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusBoxes.length ? statusOf(textOf(statusBoxes[statusBoxes.length - 1])) : null,
    genres: unique(all(doc, SELECTORS.genre).concat(all(doc, SELECTORS.tag)).map(textOf).concat(type && !isUpdating(type) ? [type] : [])),
    authors: unique(people),
    chapters: chapters,
  };
}

/* ── chapters ─────────────────────────────────────────────────────────── */

var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var UNITS = [
  [/^(?:second|sec|s)/, 1e3], [/^(?:minute|min|m(?!o))/, 6e4], [/^(?:hour|hr|h)/, 36e5], [/^(?:day|d)/, 864e5],
  [/^(?:week|wk|w)/, 6048e5], [/^(?:month|mo)/, 2592e6], [/^(?:year|yr|y)/, 31536e6],
];

function dayIso(year, month, day) {
  if (!(year > 1990 && month >= 0 && month < 12 && day >= 1 && day <= 31)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString();
}

function monthOf(text) {
  var index = MONTHS.indexOf(String(text).slice(0, 3).toLowerCase());
  return index;
}

/** A date in the site's format (`dateFormat`, Java-style letters), or a few common ones. */
function byFormat(text, format) {
  var groups = [];
  var pattern = format.replace(/(y+|M+|d+)|([.*+?^${}()|[\]\\])|(\s+)/g, function (whole, token, special, space) {
    if (space) return '\\s*';
    if (special) return '\\' + special;
    groups.push(token);
    if (token === 'MMMM' || token === 'MMM') return '([^\\s\\d,.]+)\\.?';
    if (token[0] === 'y') return token.length >= 4 ? '(\\d{4})' : token.length === 3 ? '(\\d{2,4})' : '(\\d{2})';
    return '(\\d{1,2})';
  });
  var match = new RegExp(pattern, 'i').exec(text);
  if (!match) return null;
  var year = null;
  var month = null;
  var day = null;
  groups.forEach(function (token, i) {
    var value = match[i + 1];
    if (token[0] === 'y') year = value.length === 2 ? 2000 + Number(value) : Number(value);
    else if (token[0] === 'd') day = Number(value);
    else month = token.length >= 3 ? monthOf(value) : Number(value) - 1;
  });
  return dayIso(year, month, day);
}

function dateOf(text, now) {
  if (!text) return null;
  var s = clean(text).toLowerCase();
  now = now || Date.now();
  var midnight = Math.floor(now / 864e5) * 864e5;
  if (/^(today|just now|now)\b/.test(s)) return new Date(midnight).toISOString();
  if (/^yesterday\b/.test(s)) return new Date(midnight - 864e5).toISOString();
  var relative = /(\d+|an?|one)\s*([a-z]+)\s*ago/.exec(s);
  if (relative) {
    var amount = /^\d/.test(relative[1]) ? Number(relative[1]) : 1;
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i][0].test(relative[2])) return new Date(now - amount * UNITS[i][1]).toISOString();
  }
  var formats = [SITE.dateFormat || 'MMMM d, yyyy', 'MMMM d, yyyy', 'd MMMM yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy'];
  for (var f = 0; f < formats.length; f++) {
    var date = byFormat(s, formats[f]);
    if (date) return date;
  }
  return null;
}

/** "Chapter 12.5 - Title" → 12.5; the chapter's own link is the fallback ("…/chapter-12-5/"). */
function numberOf(name, url) {
  var match = /(?:chapter|chap|ch|episode|ep)\.?\s*(\d+(?:[.,]\d+)?)/i.exec(name);
  if (!match) {
    var slug = /\/(?:chapter|chap|ch|episode|ep)[-_]?(\d+)(?:[-_.](\d{1,2}))?(?:[-_][^\/]*)?\/?$/i.exec(url);
    if (slug) return Number(slug[1] + (slug[2] ? '.' + slug[2] : ''));
    match = /(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$|:)/.exec(name);
  }
  if (match) return Number(match[1].replace(',', '.'));
  if (/prologue|oneshot|one-shot/i.test(name)) return 0;
  return null;
}

/** Locked chapters (coins, "premium") can't be read without an account, so they're left out. */
function isLocked(el) {
  var classes = attr(el, 'class');
  if (/\bfree-chap\b/.test(classes)) return false;
  return /\b(?:premium|premium-block|locked|vip)\b/i.test(classes) || Boolean(first(el, 'i.fa-lock, .icon-lock, .coin:not(.free)'));
}

function chapterEntries(doc) {
  var out = [];
  all(doc, SELECTORS.chapter).forEach(function (el) {
    if (isLocked(el)) return;
    var link = first(el, SELECTORS.chapterLink);
    var url = link ? absolute(attr(link, 'href'), doc.url).replace(/#.*$/, '') : '';
    // Early-access chapters often link out (Patreon, Ko-fi); only the site's own chapters can be read.
    if (!url || hostOf(url) !== hostOf(BASE)) return;
    var name = SELECTORS.chapterName ? textOf(first(el, SELECTORS.chapterName)) : textOf(link);
    var dateText = attr(first(el, 'img:not(.thumb)'), 'alt') || attr(first(el, 'span a'), 'title') || textOf(first(el, SELECTORS.chapterDate));
    out.push({ url: url, title: name || null, date: dateOf(dateText) });
  });
  return out;
}

/** One chapter per number, oldest first (Otavue ids chapters by number). */
function numbered(entries) {
  var seen = {};
  var out = [];
  entries.slice().reverse().forEach(function (entry) {
    var number = numberOf(entry.title || '', entry.url);
    if (number === null || seen[number]) return;
    seen[number] = true;
    out.push({ url: entry.url, title: entry.title, number: number, date: entry.date });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

function postIdOfPage(doc) {
  return attr(first(doc, '[id^=manga-chapters-holder]'), 'data-id') ||
    attr(first(doc, 'input.rating-post-id'), 'value') ||
    attr(first(doc, 'a[data-post]'), 'data-post') ||
    (/[?&]p=(\d+)/.exec(attr(first(doc, 'link[rel=shortlink]'), 'href')) || [])[1] ||
    (/"manga_id"\s*:\s*"(\d+)"/.exec(rawText(first(doc, 'script#wp-manga-js-extra'))) || [])[1] ||
    null;
}

function canonicalOf(doc) {
  var url = attr(first(doc, 'link[rel=canonical]'), 'href') || doc.url;
  url = absolute(url).replace(/[?#].*$/, '');
  return /\/$/.test(url) ? url : url + '/';
}

/**
 * The chapter list. Madara sites put it in the title page, or load it from
 * `<title>/ajax/chapters/` (newer) or `admin-ajax.php` (older); "auto" tries them in that order.
 */
async function chaptersOf(doc) {
  var mode = SITE.chapters || 'auto';
  if (mode === 'page' || mode === 'auto') {
    var inPage = chapterEntries(doc);
    if (inPage.length || mode === 'page') return numbered(inPage);
  }
  var titleLink = canonicalOf(doc);
  if (mode === 'paged') {
    var entries = [];
    for (var t = 1; t <= 50; t++) {
      var part = chapterEntries(await post(titleLink + 'ajax/chapters/?t=' + t, [], [404]));
      if (part.length === 0 || (entries.length && part[part.length - 1].url === entries[entries.length - 1].url)) break;
      entries = entries.concat(part);
    }
    return numbered(entries);
  }
  if (mode === 'ajax' || mode === 'auto') {
    var res = await request(titleLink + 'ajax/chapters/', { method: 'POST', headers: AJAX_HEADERS, body: '', allow: [400, 403, 404, 405, 500] });
    if (res.ok) {
      var ajaxDoc = parseHtml(await res.text());
      ajaxDoc.url = titleLink;
      // A list whose chapters are all locked is still the answer; only a missing list means "try the older endpoint".
      if (mode === 'ajax' || first(ajaxDoc, SELECTORS.chapter) || first(ajaxDoc, '.listing-chapters_wrap')) return numbered(chapterEntries(ajaxDoc));
    } else if (mode === 'ajax') {
      throw new Error(SITE.name + ' answered ' + res.status + '.');
    }
  }
  var id = postIdOfPage(doc);
  if (!id) return [];
  var older = await request(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST', headers: AJAX_HEADERS, body: form([['action', 'manga_get_chapters'], ['manga', id]]), allow: mode === 'admin' ? [] : [400, 403, 404],
  });
  if (!older.ok) return [];
  var olderDoc = parseHtml(await older.text());
  olderDoc.url = titleLink;
  return numbered(chapterEntries(olderDoc));
}

async function getChapters(url) {
  return chaptersOf(await titlePage(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

function md5(bytes) {
  var shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  var k = [];
  for (var i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  var length = bytes.length;
  var padded = new Uint8Array(((length + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  var bits = length * 8;
  for (var b = 0; b < 4; b++) padded[padded.length - 8 + b] = (bits >>> (8 * b)) & 255;
  padded[padded.length - 4] = Math.floor(length / 536870912) & 255;
  var h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
  for (var offset = 0; offset < padded.length; offset += 64) {
    var w = [];
    for (var j = 0; j < 16; j++) {
      var p = offset + j * 4;
      w[j] = padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
    }
    var a = h[0], bb = h[1], c = h[2], d = h[3];
    for (var r = 0; r < 64; r++) {
      var f, g;
      if (r < 16) { f = (bb & c) | (~bb & d); g = r; }
      else if (r < 32) { f = (d & bb) | (~d & c); g = (5 * r + 1) % 16; }
      else if (r < 48) { f = bb ^ c ^ d; g = (3 * r + 5) % 16; }
      else { f = c ^ (bb | ~d); g = (7 * r) % 16; }
      var sum = (a + f + k[r] + w[g]) | 0;
      var s = shifts[(r >> 4) * 4 + (r % 4)];
      a = d; d = c; c = bb;
      bb = (bb + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  }
  var out = new Uint8Array(16);
  for (var q = 0; q < 16; q++) out[q] = (h[q >> 2] >>> ((q % 4) * 8)) & 255;
  return out;
}

function concat(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Pages hidden by the "WP Manga Chapter Protector" plugin: CryptoJS AES-CBC, key and IV
 * from the page's nonce and salt (OpenSSL's EVP_BytesToKey with MD5), holding a JSON list of image URLs.
 */
async function protectedPages(protector) {
  var src = attr(protector, 'src');
  var script = /^data:text\/javascript;base64,/.test(src) ? atob(src.slice(src.indexOf(',') + 1)) : rawText(protector);
  var nonce = /wpmangaprotectornonce\s*=\s*'([^']*)'/.exec(script);
  var payload = /chapter_data\s*=\s*'([^']*)'/.exec(script);
  if (!nonce || !payload) throw new Error(SITE.name + ' changed how it protects pages.');
  var data = JSON.parse(payload[1].replace(/\\\//g, '/'));
  var password = new TextEncoder().encode(nonce[1]);
  var salt = new Uint8Array((data.s.match(/../g) || []).map(function (hex) { return parseInt(hex, 16); }));
  var derived = new Uint8Array(0);
  var block = new Uint8Array(0);
  while (derived.length < 48) {
    block = md5(concat(concat(block, password), salt));
    derived = concat(derived, block);
  }
  var cipher = Uint8Array.from(atob(data.ct), function (ch) { return ch.charCodeAt(0); });
  var key = await crypto.subtle.importKey('raw', derived.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
  var plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: derived.slice(32, 48) }, key, cipher);
  var list = JSON.parse(new TextDecoder().decode(plain));
  if (typeof list === 'string') list = JSON.parse(list);
  return list.map(function (image) { return absolute(image); }).filter(Boolean);
}

async function getPages(url) {
  url = absolute(url);
  var doc = await page(url);
  // Some sites show one page at a time unless asked for the whole list.
  if (first(doc, '#single-pager')) doc = await page(url + (url.indexOf('?') < 0 ? '?' : '&') + 'style=list');
  if (hostOf(doc.url) !== hostOf(BASE)) throw new Error('This chapter is only on ' + hostOf(doc.url) + ', not ' + SITE.name + '.');
  // Image hosts check where they're shown from: the chapter by default, the site itself where they insist (`imageReferer: "site"`).
  var pageHeaders = { Referer: SITE.imageReferer === 'site' ? BASE + '/' : url, 'User-Agent': AGENT };
  var protector = first(doc, '#chapter-protector-data');
  if (protector) {
    return (await protectedPages(protector)).map(function (image) { return { url: image, headers: pageHeaders }; });
  }
  var pages = [];
  all(doc, SELECTORS.pages).forEach(function (el) {
    var img = el.tag === 'img' ? el : first(el, 'img');
    var image = imageOf(img, url);
    if (image && /^https:\/\//.test(image)) pages.push({ url: image, headers: pageHeaders });
  });
  if (pages.length === 0 && first(doc, '.content-blocked, .chapter-locked, form.post-password-form')) {
    throw new Error('This chapter is locked on ' + SITE.name + '.');
  }
  return pages;
}
