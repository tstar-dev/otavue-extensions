# Otavue Extensions

Sources for Otavue, written in JavaScript and run inside the app's sandbox.

## Add it to Otavue

Settings → Sources → **Providers** → **Add repository**, then paste:

```
https://tstar-dev.github.io/otavue-extensions/index.json
```

Install a source from the list, then find it under the Search tab → **Sources**. Otavue checks each source's SHA-256 against this index before installing, and won't run code that has changed since.

## Sources

| Source | Language | What it is |
| --- | --- | --- |
| MangaDex | English and 13 more | [MangaDex](https://mangadex.org), through its public API, one source per language: English, Spanish (Latin America and Spain), Brazilian Portuguese, French, Italian, German, Polish, Russian, Turkish, Indonesian, Vietnamese, Thai and Arabic. Only titles rated safe or suggestive. Licensed titles often have no chapters here (MangaDex links to the publisher instead); their page says so. |
| Shōnen Jump+, Comic Days, Tonari no Young Jump and 16 more | Japanese | Japanese publishers' own readers on GigaViewer: free chapters only (usually the first few and the latest), since Otavue doesn't sign in. Some sites serve pages as shuffled tiles; Otavue puts them back together. Kurage Bunch and Sunday Web Every are marked 18+ (some of their series are). |
| TakeComic, Young Animal, Champion Cross and 24 more | Japanese | Japanese publishers' readers on Comici: free chapters only. Every page comes as shuffled tiles, which Otavue puts back together. Titles the publisher marks for adults are left out of search; the 8 sites with some adult series are marked 18+. |
| Mangasushi, Gourmet Scans, Sleepy Translations and 27 more | English | Scanlation and reader sites on Madara (WordPress). Locked (coin) chapters and chapters that only link out (Patreon) are left out. On sites not marked 18+, titles the site flags as adult are left out too; the 19 sites with adult series are marked 18+. Zazamanga, Zinmanga.net and Kun Manga are mirrors of one aggregator. Sites behind a Cloudflare check on every request, or that were down, are held back in [REMOVED.md](REMOVED.md). |
| Aster Scans, Lagoon Scans, Comic Asura, Rizz Comic and 13 more | English | Scanlation groups' sites on MangaThemesia (WordPress). Locked (coin) chapters, early-access links and novels are left out. The 5 sites with adult series are marked 18+. |
| Lua Scans | English | Lua Scans' own reader (HeanCMS, a JSON API). Free chapters only; paid and scheduled ones are left out. |
| Read One Piece, Read Berserk, Read Kingdom and 8 more | English | Single-franchise reader sites on MangaCatalog: each lists its series and spin-offs (One Piece, Attack on Titan, Berserk, Fairy Tail, Jujutsu Kaisen, Kingdom, Seven Deadly Sins, One-Punch Man, Solo Leveling, Tokyo Ghoul, Tower of God), with no search of its own, so search filters that list. Novels are left out. |
| Eris Scans, Siren Scans, Rithar Scans and 10 more | English | Scanlation groups on Keyoapp, in all three of its versions. Coin chapters, upcoming chapters and novels are left out. The 3 sites with adult series are marked 18+. |

## How it's built

Many manga sites run the same software, so a source is usually a **template** plus a **site entry**:

```
themes/<template>.js     the code, with a header: // @theme, // @version, // @type
lib/<helper>.js          code templates share; a `// @include lib/<helper>.js` line pulls it in at build time
                         (a change here changes every template that includes it: bump each one's @version)
sites/<template>.json    one entry per site: { id, name, lang, nsfw, version, config? }
build/build.mjs          template × site list → dist/sources/<id>.js and dist/index.json (with SHA-256s)
tests/                   each template against recorded responses (tests/fixtures)
tools/smoke.mjs          each built source against the live site
```

The build writes `var SITE = { id, name, lang, ...config };` above the template, so one template serves many sites (or languages). Ids start with the template's name (`mangadex.en`), and a source's version is the template's version followed by the site entry's (`1.0.0.1`), so a fix to either updates it.

```sh
npm test          # recorded responses, no network
npm run smoke     # build, then try every source against the live site (tools/smoke.mjs --jobs 8 --retry for a quick full run)
npm run build     # dist/ only
npm run check-versions   # build, then fail if a source's file changed but its version didn't (vs the published index)
```

A daily workflow (`.github/workflows/health.yml`, also runnable by hand from the Actions tab) checks every source against its live site and lists what broke in the run's summary; a failing run is GitHub's email to the owner. Sites that turn GitHub's servers away (a Cloudflare browser check, a plain 403, a refused connection) are listed apart and don't fail it: sites do that to servers far more often than to phones. It never removes anything: check a failing site by hand first.

Pushing to `main` tests, builds, checks versions against the published index, and publishes `dist/` to GitHub Pages (`.github/workflows/publish.yml`). A source whose built file changed needs a higher version (the template's `// @version` or the site entry's `version`), or the publish stops: installs only update when the version does.

## The source contract

Sources are plain scripts whose top-level functions Otavue calls (`popular({ page })`, `latest({ page })`, `search(query, page, { filters })`, `getFilters()`, `getDetail(url)`, `getChapters(url)`, `getPages(url)`). Results are `{ items, hasNextPage }` of `{ title, englishTitle?, url, cover, status? }`. `fetch` is Otavue's: https only, public hosts only, and the app paces requests. See Otavue's `client/mobile/src/services/extensions/` for the full rules.

## Adding a site

1. If its software already has a template, add an entry to `sites/<template>.json` and run `npm run smoke -- <id>`.
   Madara, MangaThemesia, Keyoapp and MangaCatalog sites take options in `config` (path names, date format, selector overrides, Keyoapp's `variant`): see the top of each template.
2. Otherwise write a template in `themes/` with recorded fixtures and tests.
3. Sites must be up, not 18+ unless marked `"nsfw": true` (Otavue hides those until the user turns on 18+), and preferably the site's own scanlation group rather than a re-host. Sites that ask to be removed go in [REMOVED.md](REMOVED.md).

## License

Apache-2.0. Templates ported from other projects say so at the top and keep that project's notice; see [NOTICE](NOTICE).
