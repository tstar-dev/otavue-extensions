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
| MangaDex | English | [MangaDex](https://mangadex.org), through its public API. Only titles rated safe or suggestive. Licensed titles often have no chapters here (MangaDex links to the publisher instead); their page says so. |
| Shōnen Jump+, Comic Days, Tonari no Young Jump and 16 more | Japanese | Japanese publishers' own readers on GigaViewer: free chapters only (usually the first few and the latest), since Otavue doesn't sign in. Some sites serve pages as shuffled tiles; Otavue puts them back together. Kurage Bunch and Sunday Web Every are marked 18+ (some of their series are). |
| TakeComic, Young Animal, Champion Cross and 24 more | Japanese | Japanese publishers' readers on Comici: free chapters only. Every page comes as shuffled tiles, which Otavue puts back together. Titles the publisher marks for adults are left out of search; the 8 sites with some adult series are marked 18+. |

## How it's built

Many manga sites run the same software, so a source is usually a **template** plus a **site entry**:

```
themes/<template>.js     the code, with a header: // @theme, // @version, // @type
sites/<template>.json    one entry per site: { id, name, lang, nsfw, version, config? }
build/build.mjs          template × site list → dist/sources/<id>.js and dist/index.json (with SHA-256s)
tests/                   each template against recorded responses (tests/fixtures)
tools/smoke.mjs          each built source against the live site
```

The build writes `var SITE = { id, name, lang, ...config };` above the template, so one template serves many sites (or languages). Ids start with the template's name (`mangadex.en`), and a source's version is the template's version followed by the site entry's (`1.0.0.1`), so a fix to either updates it.

```sh
npm test          # recorded responses, no network
npm run smoke     # build, then try every source against the live site
npm run build     # dist/ only
```

Pushing to `main` tests, builds and publishes `dist/` to GitHub Pages (`.github/workflows/publish.yml`).

## The source contract

Sources are plain scripts whose top-level functions Otavue calls (`popular({ page })`, `latest({ page })`, `search(query, page, { filters })`, `getFilters()`, `getDetail(url)`, `getChapters(url)`, `getPages(url)`). Results are `{ items, hasNextPage }` of `{ title, englishTitle?, url, cover, status? }`. `fetch` is Otavue's: https only, public hosts only, and the app paces requests. See Otavue's `client/mobile/src/services/extensions/` for the full rules.

## Adding a site

1. If its software already has a template, add an entry to `sites/<template>.json` and run `npm run smoke -- <id>`.
2. Otherwise write a template in `themes/` with recorded fixtures and tests.
3. Sites must be up, not 18+ unless marked `"nsfw": true` (Otavue hides those until the user turns on 18+), and preferably the site's own scanlation group rather than a re-host. Sites that ask to be removed go in [REMOVED.md](REMOVED.md).

## License

Apache-2.0. Templates ported from other projects say so at the top and keep that project's notice; see [NOTICE](NOTICE).
