// MangaBox (the reader behind Mangabat, Manganato and Mangakakalot; one aggregator on several domains).
// Ported from Keiyoushi's MangaBox (lib-multisrc/mangabox in github.com/keiyoushi/extensions-source, Apache-2.0):
// its list and genre pages, filter ids and genre list, the chapters API, and reading pages from the reader's script.
//
// The build puts `var SITE = { id, name, lang, baseUrl };` above this file, one copy per site.
//
// Search uses the site's quick-search JSON (/home/search/json, up to 20 titles): its /search/story/ pages are behind
// a Cloudflare check on every request. Page images need the site as Referer.
//
// @theme mangabox
// @version 1.0.0
// @type manga

var BASE = String(SITE.baseUrl).replace(/\/+$/, '');
var AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
var IMAGE_HEADERS = { Referer: BASE + '/' };

// @include lib/html.js

/* ── requests ─────────────────────────────────────────────────────────── */

function hostOf(url) {
  var match = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : '';
}

async function request(url, extra) {
  var headers = { 'User-Agent': AGENT, Referer: BASE + '/' };
  for (var key in extra || {}) headers[key] = extra[key];
  var res = await fetch(url, { headers: headers });
  if (res.status === 404) throw new Error(SITE.name + ' no longer has this.');
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    if (/cf-chl|challenge-platform|Just a moment/i.test(body)) throw new Error(SITE.name + ' wants a browser check. Open the site in Otavue, then try again.');
    throw new Error(SITE.name + ' answered ' + res.status + '.');
  }
  // A redirect off the site is an ad or a parked domain, never the page asked for.
  if (res.url && hostOf(res.url) !== hostOf(BASE)) throw new Error(SITE.name + ' no longer has this.');
  return res;
}

async function page(url) {
  var res = await request(url);
  var text = await res.text();
  // The site answers a moved title with a plain "REDIRECT : <link>" page.
  if (/^\s*REDIRECT\s*:/.test(text)) throw new Error(SITE.name + ' moved this title. Search for it again.');
  var doc = parseHtml(text);
  doc.url = res.url || url;
  return doc;
}

/** An absolute https link (Otavue only loads https; sites still print some links as http). */
function absolute(href, base) {
  href = String(href || '').trim();
  if (!href) return '';
  try { return new URL(href, base || BASE + '/').toString().replace(/^http:\/\//, 'https://'); } catch (e) { return ''; }
}

/* ── titles ───────────────────────────────────────────────────────────── */

function slugOf(url) {
  var match = /\/manga\/([^\/?#]+)/.exec(String(url));
  if (!match) throw new Error('That isn’t a ' + SITE.name + ' link.');
  return match[1];
}

function titleUrl(slug) {
  return BASE + '/manga/' + slug;
}

/** Cards from the list, genre and old search pages. */
function itemsOf(doc) {
  var seen = {};
  var items = [];
  all(doc, '.panel_story_list .story_item, div.list-truyen-item-wrap, div.list-comic-item-wrap').forEach(function (card) {
    var link = first(card, 'h3 a');
    var href = absolute(attr(link, 'href'), doc.url);
    var match = /\/manga\/([^\/?#]+)/.exec(href);
    var title = textOf(link);
    if (!match || !title || seen[match[1]]) return;
    seen[match[1]] = true;
    items.push({ title: title, url: titleUrl(match[1]), cover: absolute(attr(first(card, 'img'), 'src'), doc.url) || null, coverHeaders: IMAGE_HEADERS });
  });
  var next = Boolean(first(doc, 'div.group_page a.page_select + a:not(.page_last), div.group-page a.page-select + a:not(.page-last), a.page_select + a:not(.page_last), a.page-select + a:not(.page-last)'));
  return { items: items, hasNextPage: next };
}

/* ── lists ────────────────────────────────────────────────────────────── */

async function popular(options) {
  return itemsOf(await page(BASE + '/manga-list/hot-manga?page=' + ((options && options.page) || 1)));
}

async function latest(options) {
  return itemsOf(await page(BASE + '/manga-list/latest-manga?page=' + ((options && options.page) || 1)));
}

/** Mangakakalot's change_alias(): lower case, no accents, and every other character run as one "_". */
function searchWord(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

var FILTER_IDS = { 'newest:all': 1, 'newest:completed': 2, 'newest:ongoing': 3, 'latest:all': 4, 'latest:completed': 5, 'latest:ongoing': 6, 'topview:all': 7, 'topview:completed': 8, 'topview:ongoing': 9 };

async function search(text, pageNumber, options) {
  var word = searchWord(text);
  if (word) {
    if (pageNumber > 1) return { items: [], hasNextPage: false };
    var res = await request(BASE + '/home/search/json?searchword=' + encodeURIComponent(word), { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' });
    var rows = await res.json();
    var items = (Array.isArray(rows) ? rows : []).map(function (row) {
      var slug = row.slug || (/\/manga\/([^\/?#]+)/.exec(String(row.url || '')) || [])[1];
      return slug ? { title: clean(String(row.name || '')), url: titleUrl(slug), cover: absolute(row.thumb) || null, coverHeaders: IMAGE_HEADERS } : null;
    }).filter(function (item) { return item && item.title; });
    return { items: items, hasNextPage: false };
  }
  var filters = (options && options.filters) || {};
  var id = FILTER_IDS[(filters.sort || 'latest') + ':' + (filters.status || 'all')];
  var genre = filters.genre || 'all';
  return itemsOf(await page(BASE + '/genre/' + encodeURIComponent(genre) + '?filter=' + id + '&page=' + (pageNumber || 1)));
}

var SORTS = [['latest', 'Latest'], ['newest', 'Newest'], ['topview', 'Top read']];
var STATUSES = [['all', 'All'], ['completed', 'Completed'], ['ongoing', 'Ongoing']];
var GENRES = [
  ['4-koma', '4-Koma'], ['action', 'Action'], ['adaptation', 'Adaptation'], ['adult', 'Adult'], ['adventure', 'Adventure'],
  ['age-gap', 'Age gap'], ['ai-art', 'Ai art'], ['aliens', 'Aliens'], ['animals', 'Animals'], ['anthology', 'Anthology'],
  ['artbook', 'Artbook'], ['avant-garde', 'Avant garde'], ['award-winning', 'Award winning'], ['beasts', 'Beasts'],
  ['boys-love', 'Boys love'], ['blackmail', 'Blackmail'], ['bloody', 'Bloody'], ['bodyswap', 'Bodyswap'],
  ['brocon-siscon', 'Brocon/Siscon'], ['cars', 'Cars'], ['cartoon', 'Cartoon'], ['cheating-infidelity', 'Cheating infidelity'],
  ['childhood-friends', 'Childhood friends'], ['college-life', 'College life'], ['comedy', 'Comedy'], ['comic', 'Comic'],
  ['contest-winning', 'Contest winning'], ['cooking', 'Cooking'], ['creators', 'Creators'], ['crime', 'Crime'],
  ['crossdressing', 'Crossdressing'], ['cultivation', 'Cultivation'], ['death-game', 'Death game'], ['degeneratemc', 'Degeneratemc'],
  ['delinquents', 'Delinquents'], ['dementia', 'Dementia'], ['demons', 'Demons'], ['doujinshi', 'Doujinshi'],
  ['drama', 'Drama'], ['ecchi', 'Ecchi'], ['employee', 'Employee'], ['erotica', 'Erotica'], ['fan-colored', 'Fan colored'],
  ['fantasy', 'Fantasy'], ['female-protagonists', 'Female protagonists'], ['fetish', 'Fetish'], ['full-color', 'Full color'],
  ['game', 'Game'], ['gender-bender', 'Gender bender'], ['genderswap', 'Genderswap'], ['ghosts', 'Ghosts'],
  ['girls-love', 'Girls love'], ['gore', 'Gore'], ['gourmet', 'Gourmet'], ['graphic-novel', 'Graphic novel'],
  ['gyaru', 'Gyaru'], ['harem', 'Harem'], ['heartwarming', 'Heartwarming'], ['hentai', 'Hentai'], ['historical', 'Historical'],
  ['horror', 'Horror'], ['imageset', 'Imageset'], ['incest', 'Incest'], ['informative', 'Informative'], ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'], ['josei', 'Josei'], ['kids', 'Kids'], ['korean', 'Korean'], ['liexing', 'Liexing'],
  ['loli', 'Loli'], ['long-strip', 'Long strip'], ['mafia', 'Mafia'], ['magic', 'Magic'], ['magical-girls', 'Magical girls'],
  ['mahou-shoujo', 'Mahou shoujo'], ['male-protagonists', 'Male protagonists'], ['manga', 'Manga'], ['mangatoon', 'Mangatoon'],
  ['manhua', 'Manhua'], ['manhwa', 'Manhwa'], ['martial-arts', 'Martial arts'], ['master-servant', 'Master servant'],
  ['mature', 'Mature'], ['mecha', 'Mecha'], ['medical', 'Medical'], ['military', 'Military'], ['monsters', 'Monsters'],
  ['monster-girls', 'Monster girls'], ['murim', 'Murim'], ['music', 'Music'], ['mystery', 'Mystery'], ['netorare', 'Netorare'],
  ['netori', 'Netori'], ['ninja', 'Ninja'], ['non-human', 'Non human'], ['office', 'Office'], ['office-workers', 'Office workers'],
  ['official-colored', 'Official colored'], ['old-people', 'Old people'], ['omegaverse', 'Omegaverse'], ['one-shot', 'One shot'],
  ['others', 'Others'], ['overpowered', 'Overpowered'], ['parody', 'Parody'], ['philosophical', 'Philosophical'],
  ['ping-ping-jun', 'Ping ping jun'], ['police', 'Police'], ['pornographic', 'Pornographic'], ['post-apocalyptic', 'Post apocalyptic'],
  ['psychological', 'Psychological'], ['reincarnation', 'Reincarnation'], ['revenge', 'Revenge'], ['reverse', 'Reverse'],
  ['reverse-harem', 'Reverse harem'], ['romance', 'Romance'], ['royal-family', 'Royal family'], ['royalty', 'Royalty'],
  ['samurai', 'Samurai'], ['school', 'School'], ['school-life', 'School life'], ['sci-fi', 'Sci fi'], ['science-fiction', 'Science fiction'],
  ['seinen', 'Seinen'], ['self-published', 'Self published'], ['sexual-violence', 'Sexual violence'], ['shota', 'Shota'],
  ['shoujo', 'Shoujo'], ['shoujo-ai', 'Shoujo ai'], ['shounen', 'Shounen'], ['shounen-ai', 'Shounen ai'],
  ['showbiz', 'Showbiz'], ['slice-of-life', 'Slice of life'], ['smut', 'Smut'], ['sm-bdsm', 'Sm bdsm'], ['soft-yaoi', 'Soft yaoi'],
  ['space', 'Space'], ['sports', 'Sports'], ['spy', 'Spy'], ['step-family', 'Step family'], ['super-power', 'Super power'],
  ['superhero', 'Superhero'], ['supernatural', 'Supernatural'], ['survival', 'Survival'], ['suspense', 'Suspense'],
  ['system', 'System'], ['teacher-student', 'Teacher student'], ['thriller', 'Thriller'], ['time-travel', 'Time travel'],
  ['traditional-games', 'Traditional games'], ['tragedy', 'Tragedy'], ['vampires', 'Vampires'], ['video-games', 'Video games'],
  ['villainess', 'Villainess'], ['violence', 'Violence'], ['virtual-reality', 'Virtual reality'], ['web-comic', 'Web comic'],
  ['webtoons', 'Webtoons'], ['western', 'Western'], ['wuxia', 'Wuxia'], ['xianxia', 'Xianxia'], ['yaoi', 'Yaoi'],
  ['yuri', 'Yuri'], ['zombies', 'Zombies'], ['newest', 'completed'], ['newest', 'ongoing'], ['latest', 'completed'],
  ['latest', 'ongoing'], ['topview', 'completed'], ['topview', 'ongoing'],
];

async function getFilters() {
  var options = function (pairs) { return pairs.map(function (pair) { return { value: pair[0], label: pair[1] }; }); };
  return [
    { type: 'select', key: 'sort', name: 'Order by (ignored when searching by text)', options: options(SORTS), default: 'latest' },
    { type: 'select', key: 'status', name: 'Status', options: options(STATUSES), default: 'all' },
    { type: 'select', key: 'genre', name: 'Genre', options: [{ value: 'all', label: 'All' }].concat(options(GENRES)), default: 'all' },
  ];
}

/* ── details ──────────────────────────────────────────────────────────── */

/** "Author(s) : A, B" → the value after the label, from the info list. */
function infoValue(info, label) {
  var row = all(info, 'li, td').filter(function (el) { return new RegExp('^' + label + '\\b', 'i').test(textOf(el)); })[0];
  return row ? textOf(row).replace(/^[^:]*:\s*/, '') : '';
}

function statusOf(text) {
  if (/ongoing/i.test(text)) return 'ongoing';
  if (/completed/i.test(text)) return 'completed';
  return null;
}

function descriptionOf(doc, title) {
  var box = first(doc, 'div#noidungm, div#panel-story-info-description, div#contentBox');
  var text = clean(ownText(box) || textOf(box)).replace(new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' summary:\\s*', 'i'), '');
  var alt = ownText(first(doc, '.story-alternative, tr:has(.info-alternative) h2'));
  if (alt) text = (text ? text + '\n\n' : '') + 'Also known as: ' + alt.replace(/^Alternative\s*:\s*/i, '');
  return text;
}

/** Every chapter from the chapters API, one per number, oldest first. */
async function chaptersOf(slug) {
  var res = await request(BASE + '/api/manga/' + slug + '/chapters?limit=-1', { Accept: 'application/json' });
  var body = await res.json().catch(function () { return null; });
  var rows = (body && body.success && body.data && body.data.chapters) || [];
  var seen = {};
  var out = [];
  rows.forEach(function (row) {
    if (!row.chapter_slug) return;
    var name = clean(String(row.chapter_name || ''));
    var number = typeof row.chapter_num === 'number' ? row.chapter_num : numberOf(name, row.chapter_slug);
    if (number === null || !isFinite(number) || seen[number]) return;
    seen[number] = true;
    out.push({ url: titleUrl(slug) + '/' + row.chapter_slug, title: name || 'Chapter ' + number, number: number, date: row.updated_at || null });
  });
  return out.sort(function (a, b) { return a.number - b.number; });
}

async function getDetail(url) {
  var slug = slugOf(url);
  var doc = await page(titleUrl(slug));
  var info = first(doc, 'div.manga-info-top, div.panel-story-info');
  if (!info) throw new Error(SITE.name + ' no longer has this.');
  var title = textOf(first(info, 'h1, h2'));
  var chapters = await chaptersOf(slug);
  var description = descriptionOf(doc, title);
  if (chapters.length === 0) description = 'No chapters can be read on ' + SITE.name + ' right now.' + (description ? '\n\n' + description : '');
  var authors = all(info, 'li:contains(Author) a, td:containsOwn(Author) + td a').map(textOf);
  if (!authors.length) authors = infoValue(info, 'Author').split(',').map(clean);
  return {
    title: title,
    cover: absolute(attr(first(doc, 'div.manga-info-pic img, span.info-image img'), 'src'), doc.url) || null,
    coverHeaders: IMAGE_HEADERS,
    description: description,
    status: statusOf(infoValue(info, 'Status')),
    genres: all(info, 'li.genres a, td:containsOwn(Genres) + td a').map(textOf).filter(Boolean),
    authors: authors.filter(function (name, i) { return name && authors.indexOf(name) === i && !/^updating$/i.test(name); }),
    chapters: chapters,
  };
}

async function getChapters(url) {
  return chaptersOf(slugOf(url));
}

/* ── pages ────────────────────────────────────────────────────────────── */

/** A JS array of strings in the reader's script (`var cdns = [...]`). */
function scriptArray(text, name) {
  var match = new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(text);
  if (!match) return [];
  return match[1].split(',').map(function (part) {
    return part.trim().replace(/^["']|["']$/g, '').replace(/\\\//g, '/');
  }).filter(Boolean);
}

async function getPages(url) {
  var res = await request(url);
  var html = await res.text();
  var cdns = scriptArray(html, 'cdns').concat(scriptArray(html, 'backupImage'));
  var paths = scriptArray(html, 'chapterImages');
  var images = [];
  if (paths.length && cdns.length) {
    var cdn = cdns[0].replace(/\/+$/, '');
    images = paths.map(function (path) { return /^https?:\/\//.test(path) ? path : cdn + '/' + path.replace(/^\/+/, ''); });
  } else {
    var doc = parseHtml(html);
    images = all(doc, 'div.container-chapter-reader > img').map(function (img) { return absolute(attr(img, 'src'), res.url || url); }).filter(Boolean);
  }
  if (images.length === 0) throw new Error('This chapter has no pages on ' + SITE.name + '.');
  return images.map(function (image) {
    return { url: image.replace(/^http:\/\//, 'https://'), headers: { Referer: BASE + '/', 'User-Agent': AGENT } };
  });
}
