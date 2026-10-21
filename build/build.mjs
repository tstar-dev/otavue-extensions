// Builds the repository Otavue reads: every template × its site list becomes one
// source file, and `index.json` lists them with the SHA-256 of each exact file
// (Otavue installs only code that matches it).
//
//   node build/build.mjs [outDir]      (default: dist)

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.argv[2] ?? 'dist');

// Limits and rules Otavue enforces (client/mobile/src/services/extensions/manifest.ts).
const ID = /^[A-Za-z0-9_.-]{1,48}$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 500;
const TYPES = new Set(['anime', 'manga']);

const REPO = {
  name: 'Otavue Extensions',
  description: 'Sources for Otavue, built from shared site templates. github.com/tstar-dev/otavue-extensions',
};

/** `// @key value` lines from a template's header. */
function headerOf(code, file) {
  const header = {};
  for (const match of code.matchAll(/^\/\/ @(\w+) (.+)$/gm)) header[match[1]] = match[2].trim();
  for (const key of ['theme', 'version', 'type']) {
    if (!header[key]) throw new Error(`${file}: missing "// @${key}" in its header`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(header.version)) throw new Error(`${file}: @version must look like 1.2.3`);
  if (!TYPES.has(header.type)) throw new Error(`${file}: @type must be anime or manga`);
  return header;
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export async function build(out = OUT) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'sources'), { recursive: true });

  const sources = [];
  const seen = new Set();
  const themes = (await readdir(join(ROOT, 'themes'))).filter((file) => file.endsWith('.js')).sort();
  for (const file of themes) {
    const code = await readFile(join(ROOT, 'themes', file), 'utf8');
    const header = headerOf(code, file);
    const sites = JSON.parse(await readFile(join(ROOT, 'sites', `${header.theme}.json`), 'utf8'));
    for (const site of sites) {
      if (!ID.test(site.id)) throw new Error(`${header.theme}: bad id "${site.id}"`);
      if (!site.id.startsWith(`${header.theme}.`)) throw new Error(`${site.id}: ids start with the template name ("${header.theme}.")`);
      if (seen.has(site.id)) throw new Error(`${site.id}: listed twice`);
      seen.add(site.id);
      if (typeof site.name !== 'string' || !site.name.trim()) throw new Error(`${site.id}: needs a name`);
      if (typeof site.nsfw !== 'boolean') throw new Error(`${site.id}: "nsfw" must be true or false`);

      // The template's version, then the site entry's own, so either change updates the source.
      const version = `${header.version}.${Number.isInteger(site.version) ? site.version : 0}`;
      const config = { id: site.id, name: site.name, lang: site.lang ?? 'en', ...(site.config ?? {}) };
      const text = `// ${site.name} (${site.id} ${version}). Generated from themes/${file}; edit that, not this.\nvar SITE = ${JSON.stringify(config)};\n\n${code}`;
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error(`${site.id}: over 2 MB`);
      await writeFile(join(out, 'sources', `${site.id}.js`), text);
      sources.push({
        id: site.id,
        name: site.name,
        version,
        type: header.type,
        lang: config.lang,
        file: `sources/${site.id}.js`,
        ...(site.logo ? { logo: site.logo } : {}),
        nsfw: site.nsfw,
        theme: header.theme,
        sha256: sha256(text),
      });
    }
  }
  if (sources.length > MAX_SOURCES) throw new Error(`${sources.length} sources; Otavue reads at most ${MAX_SOURCES} per repository`);

  sources.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const index = { ...REPO, sources, extractors: [] };
  await writeFile(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = await build();
  console.log(`Built ${index.sources.length} source(s) into ${OUT}`);
  for (const source of index.sources) console.log(`  ${source.id} ${source.version} ${source.sha256.slice(0, 12)}…`);
}
