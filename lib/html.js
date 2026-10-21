// Shared helpers for templates that read HTML: a small, forgiving HTML parser and CSS selector
// engine, so the same code runs in Otavue's WebView and in Node tests, plus chapter dates and numbers.
// Templates pull it in with a `// @include lib/html.js` line, which the build replaces with this file.
//
// Selectors: tag, #id, .class, [attr], [attr=|^=|$=|*=|~=value], :not(), :has(), :contains() and :containsOwn() (Jsoup's),
// :first-child, :last-child, and the " ", ">", "+", "~" combinators.

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
      if (m) current().attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: (m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || '').replace(/\\(.)/g, '$1') });
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

function nextElement(el) {
  if (!el.parent) return null;
  var list = el.parent.children;
  for (var i = list.indexOf(el) + 1; i < list.length; i++) if (list[i].tag) return list[i];
  return null;
}

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
    if (p.name === 'containsown' && ownText(el).toLowerCase().indexOf(String(p.arg).toLowerCase()) < 0) return false;
    if (p.name === 'first-child' && previousElement(el)) return false;
    if (p.name === 'last-child' && nextElement(el)) return false;
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

/* ── dates and numbers ───────────────────────────────────────────────── */

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

/** A date in a Java-style format ("MMMM d, yyyy", "MM/dd/yy"), or null. */
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

/** A chapter date as ISO: relative ("2 hours ago"), "today"/"yesterday", the site's `format`, or a few common formats. */
function dateOf(text, format, now) {
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
  var formats = [format || 'MMMM d, yyyy', 'MMMM d, yyyy', 'd MMMM yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy'];
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
