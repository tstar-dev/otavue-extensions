// Keyoapp (a hosted reader many English scanlation groups use).
// Ported from Keiyoushi's Keyoapp (lib-multisrc/keyoapp in github.com/keiyoushi/extensions-source,
// Apache-2.0): its three generations of the site, their selectors, locked-chapter markers and page sources.
//
// The build puts `var SITE = { id, name, lang, baseUrl, ... };` above this file, one copy per site.
// Site options (all optional except baseUrl):
//   variant    "classic" (home page, /latest/, /series/), "search" (the Livewire redesign: /search, /latest?page=)
//              or "v2" (?_ajax=search, ?_ajax=recent-chapters, ?_chapters_html=1)
//   dateFormat e.g. "MMM d, yyyy" (the default)          selectors  overrides for the variant's SELECTORS
//
// @theme keyoapp
// @version 1.0.1
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var VARIANT = SITE.variant || 'classic';
var MAX_URL_BYTES = 150;
var V2_PAGE_SIZE = 20;
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var COVER_HEADERS = { Referer: BASE + '/' };

var SELECTORS = {
  classic: {
    featured: '.series-splide .splide__slide:not(.splide__slide--clone), .splide__slide.latest-poster:not(.splide__slide--clone)',
    series: '#searched_series_page > button',
    latest: 'div.grid > div.group',
    title: 'div.grid > h1, h1',
    cover: 'div[style*=photoURL], div[class*=photoURL]',
    description: '#expand_content p',
    alt: 'div.font-medium:containsOwn(Alternative titles) ~ div span',
    status: 'div[alt=Status], div:has(span:containsOwn(Status)) ~ div',
    author: 'div[alt=Author], div:has(span:containsOwn(Author)) ~ div',
    artist: 'div[alt=Artist], div:has(span:containsOwn(Artist)) ~ div',
    type: "div[alt='Series Type'], div:has(span:containsOwn(Type)) ~ div",
    genre: 'a[href*="genre="]',
    chapter: '#chapters > a, #chapters > div',
    locked: 'img[alt~=Coin], img[src*=star-circle]',
  },
  search: {
    cards: "main#main-content [wire:key*='serie']",
    latest: 'div.grid > div.group',
    next: "a[href*='?page=']",
    title: 'h1',
    description: '#expand_content p',
    alt: 'details[data-testid=series-other-names] li.select-all',
    status: 'a[aria-label=Status]',
    author: 'dt:contains(Author) + dd',
    artist: 'dt:contains(Artist) + dd',
    type: 'a[aria-label=Type]',
    genre: "a[href*='/genres/']",
    chapter: '#chapters > a, #chapters > div',
    locked: 'img[alt~=Coin], img[src*=star-circle]',
  },
  v2: {
    title: 'h1',
    description: '#series-desc',
    status: 'div.text-xs:containsOwn(Status) + div span.text-sm',
    author: 'div:has(span.text-xs:containsOwn(Author)) + span',
    artist: 'div:has(span.text-xs:containsOwn(Artist)) + span',
    genre: 'a[href*="?browse&tag"]',
  },
}[VARIANT];
(function () {
  var overrides = SITE.selectors || {};
  for (var key in overrides) SELECTORS[key] = overrides[key];
})();

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

async function request(url, allow) {
  var res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'text/html,application/json,*/*;q=0.8', Referer: BASE + '/' } });
  if (res.ok || (allow && allow.indexOf(res.status) >= 0)) return res;
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
  }
  throw new Error(SITE.name + ' answered ' + res.status + '.');
}

async function page(url) {
  var res = await request(url);
  var doc = parseHtml(await res.text());
  doc.url = res.url || url;
  return doc;
}

async function json(url) {
  return (await request(url)).json();
}

/** An absolute https link (Otavue only loads https). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : '';
}

/** A JavaScript string literal's text (`"`, `\/`, `\\`…). */
function jsString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, function (_, code) {
    if (code[0] === 'u' || code[0] === 'x') return String.fromCharCode(parseInt(code.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[code] || code;
  });
}

/* ── titles ───────────────────────────────────────────────────────────── */

function byteLength(text) {
  return unescape(encodeURIComponent(text)).length;
}

function titleUrl(href) {
  var url = absolute(href).replace(/[?#].*$/, '');
  return url && hostOf(url) === hostOf(BASE) && byteLength(url) <= MAX_URL_BYTES ? url : '';
}

/** A `background-image: url(…)` or `--photoURL: url(…)` cover, asked for at 480 px (Keyoapp resizes on request). */
function styleImage(el) {
  var match = /url\(['"]?([^'")]+)/.exec(attr(el, 'style'));
  if (!match) return null;
  var url = absolute(match[1]);
  return url ? url.replace(/([?&])w=\d+/, '$1w=480') : null;
}

function imageOf(img) {
  if (!img) return null;
  var value = attr(img, 'data-src').trim() || attr(img, 'src').trim();
  if (!value || /^data:/.test(value) || /placeholder/.test(value)) return null;
  return absolute(value) || null;
}

/** Novels share these sites' lists; Otavue reads them as manga, so they're left out. */
function isNovel(el) {
  if (/^novel$/i.test(attr(el, 'data-type'))) return true;
  return all(el, '[data-type], span').some(function (node) {
    return /^novel$/i.test(attr(node, 'data-type')) || (node.tag === 'span' && /^novel$/i.test(ownText(node)));
  });
}

/** A card: its first link (or itself), the link's title, and its cover from a style or an <img>. */
function cardItem(card) {
  var link = card.tag === 'a' && attr(card, 'href') ? card : first(card, 'a[href]');
  if (!link || isNovel(card)) return null;
  var url = titleUrl(attr(link, 'href'));
  var title = clean(attr(link, 'title')) || clean(attr(card, 'alt')) || textOf(first(card, 'h2, h3')) || textOf(link);
  // The home carousel marks novels only in the title ("Name [Novel]").
  if (!url || !title || /\[\s*novel\s*\]/i.test(title)) return null;
  var styled = card.attrs.style ? card : first(card, '[style*=background-image]');
  var cover = styleImage(styled) || imageOf(first(card, "img[alt$=' cover'], img.ru-cover-img, img"));
  return { title: title, url: url, cover: cover, coverHeaders: COVER_HEADERS };
}

function itemsFrom(cards) {
  var seen = {};
  return cards.map(cardItem).filter(function (item) {
    if (!item || seen[item.url]) return false;
    seen[item.url] = true;
    return true;
  });
}

/* ── lists ────────────────────────────────────────────────────────────── */

var SORTS = [['latest', 'Latest'], ['trending', 'Trending'], ['popular', 'Popular'], ['views', 'Most viewed'], ['rating', 'Top rated'], ['az', 'A–Z'], ['za', 'Z–A']];
var TYPES = [['', 'All'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['manga', 'Manga'], ['mangatoon', 'Mangatoon'], ['comic', 'Comic']];
var STATUSES = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['dropped', 'Dropped'], ['hiatus', 'Hiatus']];

/** Classic sites list every series on /series/, with genres, type and status on each entry. */
async function classicSeries() {
  return all(await page(BASE + '/series/'), SELECTORS.series);
}

function matchesFilters(entry, query, filters) {
  if (query && clean(attr(entry, 'title')).toLowerCase().indexOf(query.toLowerCase()) < 0) return false;
  if (filters.type && attr(entry, 'data-type').toLowerCase() !== filters.type) return false;
  if (filters.status && attr(entry, 'data-status').toLowerCase() !== filters.status) return false;
  var genres = [].concat(filters.genres || []).filter(Boolean);
  if (genres.length) {
    var tags = [];
    try { tags = JSON.parse(attr(entry, 'tags').replace(/___/g, "'")); } catch (e) { tags = []; }
    var lower = tags.map(function (tag) { return String(tag).toLowerCase(); });
    if (!genres.every(function (genre) { return lower.indexOf(genre.toLowerCase()) >= 0; })) return false;
  }
  return true;
}

/** `?_ajax=search`: `{ html, has_more }`, 20 at a time. */
async function v2List(pageNumber, params) {
  var query = ['_ajax=search'].concat(params, ['offset=' + (pageNumber - 1) * V2_PAGE_SIZE]).join('&');
  var data = await json(BASE + '/?' + query);
  return { items: itemsFrom(all(parseHtml(data.html), 'a.group[href]')), hasNextPage: Boolean(data.has_more) };
}

/** The Livewire redesign's /search page: 20 cards a page. */
async function searchList(pageNumber, params) {
  var query = params.concat(pageNumber > 1 ? ['page=' + pageNumber] : []).join('&');
  var cards = all(await page(BASE + '/search' + (query ? '?' + query : '')), SELECTORS.cards);
  return { items: itemsFrom(cards), hasNextPage: cards.length >= 20 };
}

async function popular(options) {
  var pageNumber = (options && options.page) || 1;
  if (VARIANT === 'v2') return v2List(pageNumber, ['sort=popular']);
  if (VARIANT === 'search') return searchList(pageNumber, ['sort=popular']);
  if (pageNumber > 1) return { items: [], hasNextPage: false };
  // The home page only features a few titles, so the full series list follows them.
  var featured = itemsFrom(all(await page(BASE + '/'), SELECTORS.featured));
  var everything = itemsFrom(await classicSeries());
  var seen = {};
  featured.forEach(function (item) { seen[item.url] = true; });
  return { items: featured.concat(everything.filter(function (item) { return !seen[item.url]; })), hasNextPage: false };
}

async function latest(options) {
  var pageNumber = (options && options.page) || 1;
  if (VARIANT === 'v2') {
    var doc = await page(BASE + '/?_ajax=recent-chapters&page=' + pageNumber);
    var seen = {};
    var items = [];
    all(doc, 'article.ru-card').forEach(function (card) {
      var link = first(card, 'h2.ru-title > a');
      var url = link ? titleUrl(attr(link, 'href')) : '';
      if (!url || seen[url] || isNovel(card)) return;
      seen[url] = true;
      items.push({ title: textOf(link), url: url, cover: imageOf(first(card, 'img.ru-cover-img')), coverHeaders: COVER_HEADERS });
    });
    return { items: items, hasNextPage: Boolean(first(doc, 'button[aria-label="Next recently updated page"]:not([disabled])')) };
  }
  if (VARIANT === 'search') {
    var listing = await page(BASE + '/latest?page=' + pageNumber);
    return { items: itemsFrom(all(listing, SELECTORS.latest)), hasNextPage: Boolean(first(listing, "a[href*='?page=" + (pageNumber + 1) + "']")) };
  }
  if (pageNumber > 1) return { items: [], hasNextPage: false };
  return { items: itemsFrom(all(await page(BASE + '/latest/'), SELECTORS.latest)), hasNextPage: false };
}

async function search(query, pageNumber, options) {
  var filters = (options && options.filters) || {};
  query = String(query || '').trim();
  pageNumber = pageNumber || 1;
  if (VARIANT === 'v2') {
    var params = [];
    if (query) params.push('q=' + encodeURIComponent(query));
    if (filters.sort) params.push('sort=' + encodeURIComponent(filters.sort));
    if (filters.type) params.push('type=' + encodeURIComponent(filters.type));
    if (filters.status) params.push('status=' + encodeURIComponent(filters.status));
    [].concat(filters.genres || []).filter(Boolean).forEach(function (tag) { params.push('tag%5B%5D=' + encodeURIComponent(tag)); });
    return v2List(pageNumber, params);
  }
  if (VARIANT === 'search') {
    var lw = [];
    if (query) lw.push('title=' + encodeURIComponent(query.slice(0, 100)));
    if (filters.sort) lw.push('sort=' + encodeURIComponent(filters.sort));
    if (filters.type) lw.push('type=' + encodeURIComponent(filters.type));
    if (filters.status) lw.push('status=' + encodeURIComponent(filters.status));
    var genre = [].concat(filters.genres || [])[0];
    if (genre) lw.push('genre=' + encodeURIComponent(genre));
    return searchList(pageNumber, lw);
  }
  // Classic: the whole list is one page, filtered here as the site's own page does.
  if (pageNumber > 1) return { items: [], hasNextPage: false };
  var entries = (await classicSeries()).filter(function (entry) { return matchesFilters(entry, query, filters); });
  return { items: itemsFrom(entries), hasNextPage: false };
}

var genreCache = null;

async function genresOf() {
  if (genreCache) return genreCache;
  var out = [];
  if (VARIANT === 'v2') {
    all(await page(BASE + '/?browse=1'), '#fsel-genres a[role=option][href]').forEach(function (link) {
      var tag = /[?&]tag(?:%5B%5D|\[\])=([^&]+)/.exec(attr(link, 'href'));
      if (tag) out.push({ value: decodeURIComponent(tag[1]), label: textOf(link) || decodeURIComponent(tag[1]) });
    });
  } else if (VARIANT === 'search') {
    all(await page(BASE + '/search'), '[wire:model.live=genre] option').forEach(function (option) {
      if (attr(option, 'value') && !/^all$/i.test(textOf(option))) out.push({ value: attr(option, 'value'), label: textOf(option) });
    });
  } else {
    // `initializeDropdownMenu({ type: "genre", … items: [{ value: "action", displayName: "Action" }, …] })`
    var script = all(await page(BASE + '/series/'), 'script').map(rawText).filter(function (text) { return /initializeDropdownMenu/.test(text); })[0] || '';
    var block = script.slice(script.indexOf('type: "genre"'));
    block = block.slice(block.indexOf('items:'), block.indexOf(']') + 1);
    var item = /value:\s*"([^"]*)"\s*,\s*displayName:\s*"([^"]*)"/g;
    var match;
    while ((match = item.exec(block))) out.push({ value: match[1], label: match[2] });
  }
  genreCache = out;
  return out;
}

async function getFilters() {
  var genres = await genresOf().catch(function () { return []; });
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  var out = [];
  if (VARIANT !== 'classic') out.push({ type: 'select', key: 'sort', name: 'Sort by', options: options(SORTS), default: 'latest' });
  out.push({ type: 'select', key: 'type', name: 'Type', options: options(TYPES), default: '' });
  out.push({ type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: '' });
  if (genres.length) {
    // The Livewire search takes one genre at a time.
    if (VARIANT === 'search') out.push({ type: 'select', key: 'genres', name: 'Genre', options: [{ value: '', label: 'All' }].concat(genres), default: '' });
    else out.push({ type: 'multi', key: 'genres', name: 'Genres', options: genres, default: [] });
  }
  return out;
}

/* ── details ──────────────────────────────────────────────────────────── */

function statusOf(text) {
  var value = String(text || '').toLowerCase();
  if (/ongoing/.test(value)) return 'ongoing';
  if (/completed/.test(value)) return 'completed';
  if (/dropped|cancel/.test(value)) return 'cancelled';
  if (/paused|hiatus/.test(value)) return 'hiatus';
  return null;
}

function unique(values) {
  var seen = {};
  return values.filter(function (value) {
    var key = value.toLowerCase();
    if (!value || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

async function getDetail(url) {
  var doc = await page(absolute(url));
  var title = textOf(first(doc, SELECTORS.title));
  if (!title) throw new Error('That isn’t a ' + SITE.name + ' title page.');
  var cover = VARIANT === 'v2' ? null : styleImage(first(doc, SELECTORS.cover || '[style*=photoURL]'));
  if (!cover && VARIANT === 'search') cover = imageOf(first(doc, "img[alt$=' cover']"));
  if (!cover) cover = absolute(attr(first(doc, 'meta[property="og:image"]'), 'content')) || null;
  var description = all(doc, SELECTORS.description).map(textOf).filter(Boolean).join('\n\n');
  if (SELECTORS.alt) {
    var alt = all(doc, SELECTORS.alt).map(textOf).filter(function (name) { return name && name !== 'No alternative titles.'; });
    if (alt.length) description = (description ? description + '\n\n' : '') + 'Also known as: ' + unique(alt).join(', ');
  }
  var type = SELECTORS.type ? textOf(first(doc, SELECTORS.type)) : '';
  var people = [first(doc, SELECTORS.author), first(doc, SELECTORS.artist)].map(textOf).filter(function (name) { return name && name !== '-'; });
  var chapters = await chaptersOf(doc);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  return {
    title: title,
    cover: cover,
    coverHeaders: COVER_HEADERS,
    description: description,
    status: statusOf(textOf(first(doc, SELECTORS.status))),
    genres: unique((type ? [type.charAt(0).toUpperCase() + type.slice(1)] : []).concat(all(doc, SELECTORS.genre).map(function (link) {
      return textOf(link).replace(/^[,\s]+|[,\s]+$/g, '');
    }))),
    authors: unique(people),
    chapters: chapters,
  };
}

/* ── chapters ─────────────────────────────────────────────────────────── */

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

/** Chapters listed in the title page (classic and Livewire). Locked (coin) and upcoming ones are left out. */
function pageChapters(doc) {
  var entries = [];
  all(doc, SELECTORS.chapter).forEach(function (el) {
    if (first(el, SELECTORS.locked) || all(el, '.text-sm span, span').some(function (span) { return /^upcoming$/i.test(ownText(span)); })) return;
    var link = el.tag === 'a' ? el : first(el, 'a[href]');
    var url = link ? absolute(attr(link, 'href'), doc.url) : '';
    if (!url || hostOf(url) !== hostOf(BASE)) return;
    var name = clean(attr(link, 'title')) || textOf(first(el, '.text-sm'));
    var date = attr(link, 'd') || textOf(first(el, '.text-xs'));
    entries.push({ url: url, title: name || null, date: dateOf(date, SITE.dateFormat || 'MMM d, yyyy') });
  });
  return numbered(entries);
}

/** V2: `?_chapters_html=1&series_slug=…` → `{ rows_html }`. */
async function v2Chapters(slug) {
  var data = await json(BASE + '/?_chapters_html=1&series_slug=' + encodeURIComponent(slug));
  var entries = [];
  all(parseHtml(data.rows_html || ''), 'a.chapter-row[href]').forEach(function (row) {
    if (attr(row, 'data-ch-locked') === '1') return;
    entries.push({
      url: absolute(attr(row, 'href')),
      title: clean(attr(row, 'data-ch-label')) || null,
      date: dateOf(textOf(first(row, '.ch-date-row span:last-child')), SITE.dateFormat || 'MMM d, yyyy'),
    });
  });
  return numbered(entries);
}

function slugOfV2(doc) {
  return attr(first(doc, '[data-series-slug]'), 'data-series-slug') ||
    (/\/([^\/?#]+)\/?(?:[?#].*)?$/.exec(doc.url) || [])[1] || '';
}

async function chaptersOf(doc) {
  return VARIANT === 'v2' ? v2Chapters(slugOfV2(doc)) : pageChapters(doc);
}

async function getChapters(url) {
  return chaptersOf(await page(absolute(url)));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** Classic pages are `<img uid=…>` filled in from a `realUrl = \`https://cdn…/uploads/${uid}\`` template. */
function classicPages(doc) {
  var template = null;
  all(doc, 'script').some(function (script) {
    var match = /realUrl\s*=\s*`([^`]+)`/.exec(rawText(script));
    if (match) template = match[1];
    return Boolean(match);
  });
  var images = all(doc, '#pages > img');
  var uids = images.map(function (img) { return attr(img, 'uid'); }).filter(Boolean);
  if (uids.length) {
    if (!template) throw new Error(SITE.name + ' changed where its pages are kept.');
    return uids.map(function (uid) { return template.replace(/\$\{[^}]*\}/, uid); });
  }
  // Older chapters link the images directly.
  return images.map(imageOf).filter(function (url) { return url && /\/\/cdn\d*\.keyoapp\.com/.test(url); });
}

/** Livewire pages: `immersiveReader({ pages: JSON.parse('[{"path": …, "width": …, "height": …}]') })`. */
function searchPages(doc) {
  var reader = first(doc, '[x-data^=immersiveReader]');
  var match = reader && /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/.exec(attr(reader, 'x-data'));
  if (!match) throw new Error('This chapter is locked on ' + SITE.name + '.');
  return JSON.parse(jsString(match[1])).map(function (entry) {
    return { url: absolute(entry.path), width: entry.width || undefined, height: entry.height || undefined };
  });
}

async function getPages(url) {
  url = absolute(url);
  var doc = await page(url);
  var headers = { Referer: BASE + '/', 'User-Agent': AGENT };
  var pages;
  if (VARIANT === 'v2') pages = all(doc, '#strip-reader img.reader-page').map(function (img) { return { url: imageOf(img) }; });
  else if (VARIANT === 'search') pages = searchPages(doc);
  else pages = classicPages(doc).map(function (image) { return { url: absolute(image) }; });
  return pages.filter(function (p) { return p.url && /^https:\/\//.test(p.url); }).map(function (p) {
    var out = { url: p.url, headers: headers };
    if (p.width && p.height) { out.width = p.width; out.height = p.height; }
    return out;
  });
}
