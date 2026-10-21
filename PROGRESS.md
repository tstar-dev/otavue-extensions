# Progress

Work notes for this repository, newest first. Otavue's own docs (`docs/EXTENSION_REPOSITORY_PLAN.md` → "Progress", `docs/HANDOFF_EXTENSIONS.md` §3–4, `docs/PROGRESS.md` "Start here" item 6) haven't been updated for these entries yet; copy them across when that repository is next edited.

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
