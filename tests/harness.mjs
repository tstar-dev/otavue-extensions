// Loads a built source the way Otavue's sandbox does (client/mobile/src/services/extensions/sandbox.ts):
// the code runs inside a function given `fetch`, `extractVideo` and `console`, and its
// top-level functions are what Otavue can call.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const METHODS = ['getInfo', 'getHome', 'popular', 'latest', 'search', 'getFilters', 'getDetail', 'getEpisodes', 'getVideoSources',
  'getSettings', 'getChapters', 'getPages', 'extract'];

export function loadSource(code, fetchImpl) {
  const exports = METHODS.map((m) => `${JSON.stringify(m)}: typeof ${m} === 'function' ? ${m} : null`);
  const factory = new Function('fetch', 'extractVideo', 'console', `${code}\n;return {${exports.join(',')}};`);
  return factory(fetchImpl, () => Promise.reject(new Error('no extractors in tests')), console);
}

export const fixture = async (path) => JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', path), 'utf8'));

/** Answers like Otavue's bridge does, from `routes` ([test(url) → body | { status, body }]); records every request. */
export function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, opts = {}) => {
    requests.push({ url: String(url), headers: opts.headers ?? {} });
    const route = routes.find(([test]) => test(new URL(url)));
    if (!route) throw new Error(`No fixture for ${url}`);
    const answer = typeof route[1] === 'function' ? await route[1](new URL(url)) : route[1];
    const { status = 200, body } = answer && typeof answer === 'object' && 'status' in answer ? answer : { body: answer };
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, body: text, text: async () => text, json: async () => JSON.parse(text) };
  };
  return { fetchImpl, requests };
}
