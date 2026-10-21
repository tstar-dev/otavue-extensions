# Progress

Work notes for this repository, newest first. Otavue's own docs (`docs/EXTENSION_REPOSITORY_PLAN.md` → "Progress", `docs/HANDOFF_EXTENSIONS.md` §3–4, `docs/PROGRESS.md` "Start here" item 6) haven't been updated for these entries yet; copy them across when that repository is next edited.

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
