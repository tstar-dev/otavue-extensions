# Progress

Work notes for this repository, newest first. Otavue's own docs (`docs/EXTENSION_REPOSITORY_PLAN.md` → "Progress", `docs/HANDOFF_EXTENSIONS.md` §3–4, `docs/PROGRESS.md` "Start here" item 6) haven't been updated for these entries yet; copy them across when that repository is next edited.

## 2026-10-21: MangaTaro (2 sources, 1 18+)

- **New template** `themes/mangataro.js`, ported from Keiyoushi's `lib-multisrc/mangataro`:
  - Lists: POST `/wp-json/manga/v1/load` (24 rows; its list fields are JSON strings such as `"[\"Manhwa\"]"`). Novels and rows without a link are left out. Rolia Scan's lists mix in chapter entries without a link, so its Latest and filtered lists read five API pages per page, as Keiyoushi does (`mergePages`).
  - Search: the site's search box, POST `/auth/search` (up to 25 titles). Filters (sort, type, status, year) go through `/load`. Keiyoushi's long tag lists are left out.
  - Details: WordPress's REST API (`/wp-json/wp/v2/manga/<id>?_embed`): tags, `manga_author` terms, featured image.
  - **Chapters:** `/auth/manga-chapters` needs `_t` = the first 16 hex digits of md5(`<unix seconds>mng_ch_<yyyyMMddHH UTC>`). The template carries its own md5 (the sandbox has none; checked against Node's). On a 403 it retries once on the server's `Date` header, as Keiyoushi does for skewed clocks. Only the site's language is kept (MangaTaro lists pt-br chapters too).
  - Pages: `/auth/chapter-content?chapter_id=` (the id at the end of the chapter link).
  - Title links are `<site>/manga/<slug>#<id>`; the id is what the API needs. Keiyoushi's view counting is left out.
- **Sites:** MangaTaro (an aggregator, 18+: Keiyoushi marks it MIXED) and Rolia Scan (SAFE).
- 149 tests. Live check: 2 of 2 passed. 170 sources, 51 marked 18+.

## 2026-10-21: FoOlSlide (5 sources)

- **New template** `themes/foolslide.js`, ported from Keiyoushi's `lib-multisrc/foolslide`: `/directory/N/` (Popular), `/latest/N/`, search as a form POST to `/search/`, title and chapter pages fetched with the `adult=true` form (as Keiyoushi does, to skip the content warning), and pages from the reader's `var pages = [...]`.
  - Chapter numbers come from the reader link (`/read/<slug>/<lang>/<volume>/<chapter>/<sub>/`, so `/43/1/` is 43.1), else the name. Dates: "by Group, 2020.01.11", relative ones, and today/yesterday in English, Italian and Spanish.
  - The title falls back to the page's `<title>` ("Name :: Site") where `h1.title` is empty (NIFTeam, Juin Jutsu).
  - **Juin Jutsu** (Keiyoushi's override): its directory is empty, so Popular is the series in its latest pages (which also list chapter links, left out) and there's no separate Latest; volume entries named with a bare number are left out. Its search form answers nothing, so search looks through the first five latest pages.
- **Sites (5):** Death Toll Scans and Mangatellers (English), Menudo-Fansub (Spanish) and NIFTeam (Italian; both under `/slide`), Juin Jutsu Team Reader (Italian). Keiyoushi's other FoolSlide sites are adult-only, or the "customizable" one with no address of its own.
- **Order for the two-site templates** (live English sites): FoolSlide 2 (+3 other languages), MangaTaro 2, MangAdventure 2, EzManhwa 1 (EZmanga shows a Cloudflare block page), Monochrome 1, Bakkin 1. The "custom"/"self-hosted" entries have no real address and are skipped.
- 143 tests. Live check: 5 of 5 passed. 168 sources, 50 marked 18+.

## 2026-10-21: MangaBox (2 sources, both 18+)

- **New template** `themes/mangabox.js`, ported from Keiyoushi's `lib-multisrc/mangabox`: hot and latest lists (`/manga-list/hot-manga`, `/latest-manga`), genre pages with the site's sort/status filter ids (`/genre/<slug>?filter=1…9`) and Keiyoushi's 170-genre list, title pages, chapters from `/api/manga/<slug>/chapters?limit=-1`, and pages from the reader's script (`cdns` + `chapterImages`, with the `<img>` list as a fallback).
  - **Search:** `/search/story/<words>` is behind a Cloudflare check on every request on all three sites, so search uses the header's quick-search JSON, `/home/search/json?searchword=` (up to 20 titles, words written as the site's `change_alias()` does). Keiyoushi uses the challenged page.
  - Page images and covers need the site as `Referer` (403 without). The image server is shared by all three domains.
  - Left out: Keiyoushi's optional merging of split images and its CDN fallback (only one CDN is listed now).
- **Sites:** Mangabat (www.mangabats.com) and Mangakakalot (www.mangakakalove.com), both 18+ (Keiyoushi marks them MIXED). They, and Manganato, are one aggregator with the same catalogue and ids. Keiyoushi's first Manganato and Mangakakalot domains challenge every request; these are the mirrors that don't.
- **Held back:** Manganato (manganato.gg): everything works but search, whose JSON is challenged too. In `REMOVED.md`.
- 137 tests. Live check: 2 of 2 passed (Manganato blocked on search). 163 sources, 50 marked 18+.

## 2026-10-21: Guya (6 sources, 2 18+)

- **Which template next:** every site's `build.gradle.kts` in Keiyoushi was counted by `theme`, English and not NSFW. After the ones done, the largest left are Guya and MangaBox (3 each by that count), then foolslide, monochrome, mangataro, mangadventure, ezmanhwa and bakkin (2 each); 138 English sites are standalone sources with no template. Guya won the tie: its sites are groups' own readers, and it has a fourth site (Magical Translators) that sets its language in code, which the count missed.
- **New template** `themes/guya.js`, ported from Keiyoushi's `lib-multisrc/guya`: `/api/get_all_series/` is the whole catalogue in one answer (Danke's is 2.6 MB, under Otavue's 8 MB cap), so lists have no next page and search filters it here. `/api/series/<slug>/` gives the chapters, keyed by number, each with files per group.
  - **One group per chapter:** the chapter's `preferred_sort`, else the series', else its first group, as Keiyoushi does without a preference. The group goes in the chapter link after `#`; a link without one, or with a group that's gone, falls back the same way.
  - Pages are `/media/manga/<slug>/chapters/<folder>/<group>/<file>`. Descriptions can be HTML that opens with the author's link blocks; those are dropped.
  - Keiyoushi's custom User-Agent and scanlator preference screen are left out.
- **Sites (6):** Guya, Danke fürs Lesen and Hachirumi (both 18+: Keiyoushi marks them MIXED), and Magical Translators in English, Spanish and Polish (split by slug suffix, as Keiyoushi does).
- **`tools/smoke.mjs`:** Danke's image server refuses HEAD (405, `server: MangaDex`) though GET works, so the image check now falls back to a one-byte GET on 405 or 501. That also applies to the daily health check.
- 131 tests. Live check: 6 of 6 passed. 161 sources, 48 marked 18+.

## 2026-10-21: VineTheme (7 sources, 2 18+)

- **New template** `themes/vinetheme.js`, ported from Keiyoushi's `lib-multisrc/vinetheme`, a Next.js reader:
  - Lists and search come from JSON at `/api/series` (`sort` popular/updated/…, `q`, `type`, `status`, `origin`, `genre`, `contentMode=comics`). Genres for the filter come from the `/series` page.
  - **Titles, chapters and pages only come as React Server Components data:** the page fetched with `rsc: 1` answers with rows, and the objects wanted are found by shape (`series` + `chapters`; `chapter.pages`; `tagTotal`), as Keiyoushi's `extractNextJs` does.
  - **Two RSC details Keiyoushi's parser handles and a naive one doesn't:** text rows (`id:T<hex byte length>,<text>`, used for long descriptions) have no newline after them, so the next row is glued onto the text; and long values are outlined to their own row and referenced as `"$<id>"`. Rows are read by byte length, and references inside the object found are filled in. Without that, a KeroScans title with a long description couldn't be opened at all.
  - Chapters come 100 to a page (`?sort=desc&page=N`, all pages read). `isLocked` or `hasAccess: false` (coins, early access) leaves a chapter out.
  - **Pages flagged `isEncrypted` with `tiles`/`strips` (most recent chapters on six of the seven sites) still have a plain, readable image at `imageUrl`**, checked by eye; `protectionConfig` says protection is off. Redacted pages and pages without an image are left out. Width and height are passed on.
  - **Long slugs:** KeroScans, Kayn Scans and WitchScans have slugs up to 234 characters, past Otavue's 150-byte ids, and the site has no route by id. Those links are cut short at a word and carry the series id after `#`; opening one searches `/api/series?q=` with the slug's first three words, then two, then its longest word, matching on the id.
- **Sites (7):** Diva Scans and KeroScans (18+: Keiyoushi marks them MIXED), Drake Scans, Elf Toon, Kayn Scans, Valir Scans and WitchScans. Live check: 7 of 7 passed. One Valir run failed while a chapter's images were still being uploaded (404 an hour after posting, 200 later).
- The `.rsc` fixtures hold real site data in a cut-down RSC frame with both quirks above.
- 125 tests. 155 sources, 46 marked 18+.

## 2026-10-21: YiiManga (7 sources, all 18+)

- **New template** `themes/yiimanga.js`, ported from Keiyoushi's `lib-multisrc/yiimanga`: HTML pages in three layouts (the `latest-item` and `list-item` lists; `main-info-list`, `post-content_item` and `manga-detail` title pages).
  - Lists: latest from `/page/N/`; Popular from a catalog sorted with `?order=views` (`popularPath`), from the home page's featured row (ManhwaBuddy, `popular: "home"`), or else the latest list. In that last case there's no separate `latest`.
  - **Search** (`/search/?s=` or `?q=`, per site) is a full-text search that needs every word: an apostrophe makes it answer 500, and short words and MySQL stopwords ("by", "the") never match. So queries are cleaned first (punctuation, words under 3 letters and stopwords dropped), and a multi-word search that finds nothing is tried once more with its longest word.
  - **Genre pages** are numbered two ways: `/genre/<slug>/page/2/` or `/genre/<slug>/2/` (`genrePath: "bare"` for Manhwa18TX, ManhwaOnline and ToonGod; Keiyoushi only had it for ToonGod). Page 1 is always `/genre/<slug>/`. Genres come from the home page's menu, so some sites offer only a few.
  - Dates: "06 Oct 2026", "12 Oct 26" or just "Oct 26" (read as the 1st). The newest chapter often shows a "NEW" badge instead of a date.
- **Sites (7):** Manhwa18TX, ManhwaBuddy, Manhwaddict, ManhwaGalaxy, ManhwaOnline, ToonGod (toongod.cc) and YaoiScan (yaoiscan.me). Keiyoushi marks them all MIXED, so all are `nsfw: true`. They're re-hosts, not groups' own sites. Manhwa18TX and Manhwaddict serve the same catalog (same ids and image paths). The five adult-only YiiManga sites are in `REMOVED.md`.
- 118 tests. Live check: 7 of 7 passed. 148 sources, 44 marked 18+.

## 2026-10-21: Iken (9 sources)

- **New template** `themes/iken.js`, ported from Keiyoushi's `lib-multisrc/iken`: a JSON API at `api.<site>`, sent with the site as `Origin` and `Referer` as HeanCMS is.
  - Lists come from `/api/query` (`orderBy` totalViews for Popular, lastChapterAddedAt for Latest; filters for sort, direction, status, type and genres from `/api/genres`). Novels are left out of lists and refused on open.
  - Titles come from `/api/post` (by `postSlug` or `postId`), and **chapters always come from `/api/chapters?postId=`**: on every site checked, the post's own `chapters` was empty. Keiyoushi only switches to that endpoint after noticing the mismatch.
  - **Locked chapters** are left out: `isAccessible: false` (on every site), `isLocked`, `isTimeLocked`, `isPermanentlyLocked`, `isShortLinkLocked`, a `price` not purchased, or an `unlockAt` still to come. A locked chapter's `/api/chapter` returns no images and `isLockedByCoins`, which `getPages` reports.
  - Pages come from `/api/chapter?chapterId=` in the API's `order` (by file name for Magus Manga and Sana Scans, as Keiyoushi does), with `width`/`height` when the API knows them.
  - **Links:** `<site>/series/<slug>#<id>` and `<site>/series/<slug>/<chapter>#<chapterId>`. Orion Scans' slugs run to 226 bytes, past Otavue's 150-byte ids, so a link that's too long becomes `<site>/series/#<id>` (or `/chapter/#<id>`). A plain `/series/<slug>` link still opens.
  - Left out: Keiyoushi's `analytics/updateViews` calls, which only count views.
- **Sites (9):** Azora (Arabic), Hijala Scans, Hive Scans, Ken Scans, Magus Manga, Nyx Scans, Orion Scans, Sana Scans and Vortex Scans. Keiyoushi marks every one SAFE. Renascans (522) and Vanilla Scans (521) are down and in `REMOVED.md`.
- 108 tests. Live check: 9 of 9 passed. 141 sources, 37 marked 18+.

## 2026-10-21: MangaHub held back (no template yet)

- Keiyoushi's `lib-multisrc/mangahub` covers 11 sites (MangaHub, MangaReader.site, MangaFox.fun, MangaNel, 1Manga.co and others). All of them are front ends for one GraphQL API, `api.mghcdn.com`, and their pages are empty app shells, so there's no HTML to read.
- **That API answers every non-browser request with a Cloudflare challenge** (`cf-mitigated: challenge`, 403), from curl and from Node on a home connection, with or without the site's `mhub_access` key. A real browser gets through with no cookies and even a random key, so it's the client being judged, not the address.
- A random key is enough for lists, search and chapter lists. Pages need the key the site sets as the `mhub_access` cookie (a random one gets "Chapter encryption unavailable"), and pages can come back AES-GCM encrypted (`enc:v1`, keys from `<site>/api/chapter-crypto`).
- Otavue's host `fetch` is React Native's native networking with the WebView's cookies, so it's likely challenged too. It might pass after opening `api.mghcdn.com` once in Otavue (as Mihon does it), but that needs a device check. The owner chose to move on to Iken. The 11 sites are in `REMOVED.md`.

## 2026-10-21: MangaCatalog (11 sources)

- **New template** `themes/mangacatalog.js`, ported from Keiyoushi's `lib-multisrc/mangacatalog`. Each site is one franchise (readonepiece.com, readsnk.com, readberserk.com, …) with a fixed list of series and no list or search of its own:
  - `popular` is the site's series list from `config.series` (`[title, path, cover]`) and `search` filters it by name. There's no `latest` or `getFilters`; both are optional in the app and the smoke tool.
  - Three page layouts (`layout`): `tailwind` (most sites), `bootstrap` (Berserk, One-Punch Man: a card and a dated table) and `single` (Tower of God: one series on the home page, chapters as links, pages on Blogger, `imageHosts` filters the rest).
  - **Pages:** `img.js-page, img.pages__img`, using `data-src` before `src`, skipping `data:` placeholders and repeats. Keiyoushi's `img[data-src]` misses page 1, which is never lazy. The `<noscript>` copies and a line break inside the links are handled.
  - **Hosts move** (ww12.readsnk.com → ww13…): any link on one of a site's numbered hosts is read on the current `baseUrl`, so saved titles survive a move, and redirects off the site are refused.
  - `checkNewest` leaves out newest chapters without pages: Tower of God's 653 is only a cover (the site stopped at December 2024), and Solo Leveling lists a "Ragnarok announcement" as 200.5.
  - Series with no chapter numbers at all (an art book) are numbered in the site's order.
- **Site list:** Keiyoushi's series lists plus each home page's nav (it has newer ones, such as Jujutsu Kaisen Modulo, Fairy Tail S and Blue Mistral, and Kingdom's official versions). Names and covers come from each series' own page, and the series with the most chapters is listed first. Left out: novels (Ace's Story Novel, a Jujutsu Kaisen light novel, the Solo Leveling and Attack on Titan novels), Solo Leveling's audiobook, Kingdom's PDF spoilers, Berserk's motion comic, Berserk's "Spoilers & RAW", and nav links to other sites.
- **Held back:** Read Black Clover (a saved static copy, broken chapters) and Read Chainsaw Man (NSFW in Keiyoushi). Both are in `REMOVED.md`.
- 100 tests. Live check: 11 of 11 passed. 132 sources, 37 marked 18+.

## 2026-10-21: MangaDex in 13 more languages (13 sources)

- `sites/mangadex.json` gained es-la, es, pt-br, fr, it, de, pl, ru, tr, id, vi, th and ar. The template already reads `SITE.lang`, so nothing else changed. `tests/mangadex.test.mjs` covers a second language.
- These waited in a stash while MangaDex was down for maintenance. Its API answered again on the evening of 2026-10-21, and all 13 passed the live check (`--jobs 3 --retry`).
- **Still held back:** MangaBang and Hades Scans still show maintenance pages, and Booklista Studio's lists load but its page API still answers with one.
- 90 tests. 121 sources, 37 marked 18+.

## 2026-10-21: Lua Scans, three Madara mirrors, Comic Asura and Rizz Comic (6 sources)

- **Lua Scans** (`themes/heancms.js`, new; ported from Keiyoushi's `lib-multisrc/heancms`):
  - Keiyoushi moved Lua Scans off Keyoapp onto HeanCMS, a JSON API at `api.<site>`. Its only other HeanCMS site, Omega Scans, is adult-only.
  - Lists come from `/query`, titles from `/series/<slug>`, chapters from `/chapter/query?series_id=` (paid and scheduled ones left out), and pages from `/chapter/<series>/<chapter>`.
  - **The API's firewall answers 403 unless requests carry the site as `Origin` and `Referer`**, so every API call sends them.
  - Lua's "latest" sort isn't by date in either direction, so its Latest uses `updated_at` (`latestSort`). Its tag list is empty, so it has no genre filter.
- **Madara:** Zazamanga, Zinmanga.net and Kun Manga Online, all mirrors of one aggregator (same comic ids and CDN). Madara is now 1.0.3.
  - Zazamanga only lists chapters as `div.wp-manga-chapter` (a selector override).
  - Zinmanga.net and Kun Manga use a new `chapters: "api"` mode (`/api/comics/<slug>/chapters`, JSON, using its `chapter_num`). Both need `imageReferer: "site"`.
  - Kun's latest list can run ahead of its title pages (404). `tools/smoke.mjs` now skips a title that's gone and tries the next, and fails only when nothing is readable.
- **MangaThemesia** (1.0.2): two list modes. Both sites still use the theme's title, chapter and page code with selector overrides.
  - **Comic Asura** (`list: "asura"`): `/advanced-search/?name=&sort=`, cards from `img` titles, and `data-chapter-num` for chapter numbers. Its genre list really does start with junk entries ("$h0ta", "3").
  - **Rizz Comic** (`list: "rizz"`): `/Index/filter_series` and `/Index/live_search` return JSON, with links built from titles as the site builds them.
    - Rizz sends any title link without its current `r2311170-` prefix to an **ad site** rather than a 404. So `randomSlug` sites now look the current link up first (`randomListPath: "/series"`, `randomPrefix: "^r\d+-"`).
    - `page()` refuses any redirect off the site.
    - Rizz fills its synopsis in with a script, so it's taken from the search JSON.
- **Shared code:** `lib/html.js` reads ordinal dates ("October 21st 2026"). Keyoapp went to 1.0.1 for that.
- **Checks:** 89 tests. Live check: 60 of 61 Madara, MangaThemesia, Keyoapp and HeanCMS sources passed. The 61st, Galaxy Degen Scans, timed out because its home page took 56 seconds even from curl; it passed earlier, so it stays listed. The version check passed (55 sources with new versions).

## 2026-10-21: Daily health check

- `.github/workflows/health.yml` runs every day at 06:17 UTC, and can also be started by hand from the Actions tab. It builds, then runs `tools/smoke.mjs --jobs 8 --retry --summary $GITHUB_STEP_SUMMARY`. It only reports: the run's summary lists what failed, the run fails (GitHub emails the owner), and nothing is removed.
- `tools/smoke.mjs` gained three options:
  - `--jobs N` checks N sites at once. Sources on the same site still run one after another, so the MangaDex languages don't hit its rate limit together.
  - `--retry` checks each failure once more before counting it.
  - `--summary FILE` writes a Markdown table of failures.
- **First run (local, 2026-10-21):** 99 of 115 passed in about 1.5 minutes. The 16 failures were:
  - all MangaDex sources: MangaDex was down for maintenance (503 on both the API and the website);
  - Comici's Champion Cross and Young Champion: maintenance pages.

  Re-check those before removing anything. Comic Pash, which failed on GitHub, passed again within the hour.
- **First run on GitHub:** 10 sites that pass from a home connection got Cloudflare browser checks from GitHub's servers. Cloudflare challenges datacenter addresses far more often than phones. Those 10 were Eris Scans, Cocomic, Gourmet Scans, LHTranslation, LinkManga, Manhua Plus, S2Manga, WuxiaWorld, Athrea Scans and Scythe Scans, plus Lagoon Scans. A second GitHub run, on a different server, also got plain 403s from Lily Manga, Manga Eclipse and Manhuanext, and dropped connections from ManhwaNex and Manhwa Reads. All five passed from here at the same time. So "couldn't check from here" now covers three cases: a browser check, a plain 403, and a refused or reset connection. Those are listed in their own section of the summary and don't fail the run. Everything else fails it: a domain that's gone (DNS), 5xx errors, maintenance pages, empty lists, chapters without pages, and broken images (an image 403 included).

## 2026-10-21: Version check in CI

- `tools/check-versions.mjs` (`npm run check-versions`; a step after the build in `publish.yml`) compares `dist/index.json` with the published index. It fails when a source's SHA-256 changed but its version didn't, or when a version went down. New and removed sources pass.
  - A query string gets past GitHub Pages' cache, so a second push soon after a first is compared with the first.
  - A 404 (nothing published yet) passes. Any other failure to read the index fails, so nothing ships unchecked.
- Checked against the live index: the current build passes (102 sources, nothing changed). Touching `themes/comici.js` without a bump failed all 27 Comici sources with exit 1. With `@version` bumped, it passed.
- Limit: if a push lands while the previous deploy is still running (the workflow cancels in-progress runs), the comparison is with the index before that one.

## 2026-10-21: Keyoapp (13 English sites)

- **Template:** `themes/keyoapp.js`, ported from Keiyoushi's `lib-multisrc/keyoapp` (Apache-2.0, credited in `NOTICE`). It covers the three versions of the site software in use, chosen per site with `variant`:
  - **classic** (8 sites):
    - Popular shows the home page's featured titles first, then the rest of `/series/`. The home page has no "Popular" section any more, and `/series/` holds every title.
    - Latest comes from `/latest/`.
    - Search and filters run over the `/series/` list here, the way the site's own page does it (title, type, status, genres from each entry's `tags`). Genres come from the `initializeDropdownMenu` script.
    - Pages are `#pages > img[uid]` filled into the page's `realUrl` template.
  - **search** (the Livewire redesign; Art Lapsa, Rithar Scans):
    - Popular and search come from `/search?sort=…&page=N`, and latest from `/latest?page=N`.
    - Pages come from `immersiveReader({ pages: JSON.parse('…') })`, decoded as a JS string literal. Each page's width and height are passed on to Otavue.
  - **v2** (Asmodeus Scans, Luna Toons, Siren Scans):
    - Popular and search use `?_ajax=search` (`{ html, has_more }`, 20 per page), and latest uses `?_ajax=recent-chapters`.
    - Chapters come from `?_chapters_html=1&series_slug=` (`data-ch-locked` marks locked rows). The slug is `data-series-slug`; `data-series-uid` is a different id.
    - Pages come from `#strip-reader img.reader-page`.
- **Rules applied:** coin chapters, "Upcoming" chapters and novels are left out. Novels are found by `data-type`, a "Novel" label, or "[Novel]" in the title, which is all the home carousel shows. V2 titles whose link is longer than 150 bytes are dropped, since there's no short id to fall back on.
- **Shared code:** `lib/html.js` gained `:containsOwn()`. Because that changes every built Madara and MangaThemesia file, those templates went to 1.0.2 and 1.0.1. A change to `lib/` needs a version bump in every template that includes it (README says so).
- **Sites:** 13 of Keiyoushi's 15 English Keyoapp sites that aren't adult-only. All pass the live check, with search results and filters (genres included) on each. Held back in `REMOVED.md`: MeiToon (Cloudflare) and Nyra Scans (not reachable). All 55 Madara, MangaThemesia and Keyoapp sites passed one more live check after the version bumps.
- **Not checked on the device yet.**

## 2026-10-21: MangaThemesia (15 English sites)

- **Template:** `themes/mangathemesia.js`, ported from Keiyoushi's `lib-multisrc/mangathemesia` (Apache-2.0, credited in `NOTICE`).
  - Lists and search use the theme's own list page (`/manga/?title=…&page=N&order=…&status=…&type=…&genre[]=…`).
  - Titles, chapters and filters (genres from `ul.genrez`) are read from the theme's markup.
  - Pages come from `#readerarea img`, falling back to the `ts_reader.run({… images: […]})` script, which can be inline or base64.
- **Shared code:** the HTML parser, selector engine and date/number helpers moved from `themes/madara.js` into `lib/html.js`. The build now inlines any `// @include lib/<file>.js` line, and only templates with that line change. Madara's version went to 1.0.1 because its built files changed. The selector engine gained `:last-child` and backslash escapes in attribute values (`a[href*=type\=]`).
- **Rules applied:**
  - Chapters are numbered from `data-num`, falling back to the name. Locked chapters (`#lockedChapterModal`, `data-coin`, `.locked-badge`, `.text-gold`, 🔒), chapters that link off-site, and novels are left out.
  - When a search with quotes finds nothing, it's retried without them, since some sites store curly ones.
  - **Changing title links:** Keiyoushi's "Alt" sites (Thunder Scans, Rokari Comics) can add a changing number to title links, like `/comics/7395-name/`. With `randomSlug: true` the number is kept out of Otavue's ids. When the stored link 404s, the current one is looked up in `/<path>/list-mode/`. Neither site uses the numbers right now, so that lookup is tested with fixtures only.
- **Sites:** 15 of Keiyoushi's 24 English MangaThemesia sites that aren't adult-only. All pass the live check, with search results and genre filters on each. The 9 held back are in `REMOVED.md`:
  - Rage Scans: Cloudflare.
  - CulturedWorks and Galaxy Manga: down.
  - Hades Scans: maintenance page.
  - NexComic and Razure: moved off the theme.
  - Comic Asura and Rizz Comic: their own markup or API.
  - Rizz Comic (unoriginal): a re-host.
- **Not checked on the device yet.** One live run hit a temporary timeout on Tritinia (Madara); it passed on retry.

## 2026-10-21: Madara (27 English sites)

- **Template:** `themes/madara.js`, ported from Keiyoushi's `lib-multisrc/madara` (Apache-2.0, credited in `NOTICE`). Lists use `madara_load_more` (`admin-ajax.php`), or the plain list pages on sites set to `browse: "archive"`. Chapters come from the title page, then `<title>/ajax/chapters/`, then `admin-ajax.php` (`manga_get_chapters`), whichever answers first (`chapters: "paged"` for sites that page `ajax/chapters/?t=N`). Pages come from `div.page-break img`, sent with the chapter as `Referer`.
- **HTML parsing:** the template has its own small HTML parser and CSS selector engine (tag, id, class, attributes, `:not`, `:has`, `:contains`, combinators), so Keiyoushi's selectors port as they are and tests behave like the app. No dependencies were added (no jsdom).
- **Encrypted pages:** sites using the "chapter protector" plugin (Gourmet Scans) are decrypted. The key comes from MD5 (written in JS) and decryption is AES-CBC through `crypto.subtle`, which the sandbox already uses. Tested with a page encrypted by Node's crypto. Checked live on Gourmet Scans.
- **Rules applied:**
  - Locked (premium/coin) chapters are left out, and so are chapters that link off-site (early access on Patreon).
  - One chapter per number, keeping the oldest upload when numbers repeat.
  - `http://` image links are upgraded to https.
  - Quotes in searches are straightened (WordPress search misses `’`).
  - Title URLs longer than 150 bytes fall back to `/?p=<post id>`.
- **18+:** Keiyoushi's "mixed" sites are marked `nsfw: true` with `adult: true` (adult titles kept). Other sites filter out titles the site flags as adult: in the request (`manga_adult_content` NOT LIKE "yes"; "NOT EXISTS" empties the list, because sites set the field on every title) and by the card's `18+` badge. Keiyoushi's 38 adult-only English sites weren't considered.
- **Sites:** 27 of Keiyoushi's 65 English sites that aren't adult-only. All 27 pass the live check (popular, latest, detail, chapters, pages, image, search, filters). The 38 held back are in `REMOVED.md`:
  - 16 need a Cloudflare browser check: 14 on every request, and Bun Manga and ManhuaHot on chapter pages. They need a device check of "Open site" before they're listed.
  - 5 are down.
  - 5 have broken images.
  - 3 use their own chapter API.
  - 3 are labelled re-hosts ("unoriginal").
  - 6 others: one moved to an unrelated site, two single-series fan sites, one that needs an auth cookie, one with a JS challenge, and one redesigned.
- **Tools:** `tools/smoke.mjs` now fails a source when none of the first titles has a chapter to read. Before, a source whose chapter lists all came back empty still passed.
- **Not checked on the device yet.** Next: install one Madara site (e.g. Mangasushi) and read a chapter. Then try a Cloudflare-held site (e.g. Toonily) through "Open site" to see whether those can be listed.
- **Follow-ups:** sites with their own chapter API (Zazamanga, Zinmanga.net, Kun Manga Online); the 16 Cloudflare sites; MangaThemesia next.
