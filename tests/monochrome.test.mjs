import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { build } from '../build/build.mjs';
import { fakeFetch, loadSource } from './harness.mjs';

const data = async (path) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'monochrome', path), 'utf8'));
let source;
before(async () => {
  const out = join(tmpdir(), `otavue-extensions-monochrome-${process.pid}`);
  await build(out);
  source = await readFile(join(out, 'sources', 'monochrome.monochromescans.js'), 'utf8');
});

const API = 'https://api.manga.d34d.one';
const B = 'https://manga.d34d.one';

describe('Monochrome', () => {
  const routes = async () => {
    const list = await data('list.json');
    const id = list.results[0].id;
    return [
      [(url) => url.pathname === '/manga', list],
      [(url) => url.pathname === `/manga/${id}/chapters`, await data('chapters.json')],
      // The series has its own `status` field, which fakeFetch would read as the HTTP status.
      [(url) => url.pathname === `/manga/${id}`, { status: 200, body: await data('manga.json') }],
    ];
  };

  it('lists ten series a page from the API, with covers from its media path', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    const page = await loadSource(source, fetchImpl).popular({ page: 1 });
    const first = (await data('list.json')).results[0];
    assert.equal(requests[0].url, `${API}/manga?limit=10&offset=0&title=`);
    assert.deepEqual(page.items[0], { title: first.title, url: `${B}/manga/${first.id}`, cover: `${API}/media/${first.id}/cover.jpg?version=${first.version}`, status: 'ongoing' });
    // The fixture keeps 2 of the site's 5 series, and `total` still says 5.
    assert.equal(page.hasNextPage, true);
  });

  it('searches by title', async () => {
    const { fetchImpl, requests } = fakeFetch(await routes());
    await loadSource(source, fetchImpl).search(' patchwork ', 2, {});
    assert.equal(requests[0].url, `${API}/manga?limit=10&offset=10&title=patchwork`);
  });

  it('reads a title and its chapters, oldest first, with what the pages need in the link', async () => {
    const { fetchImpl } = fakeFetch(await routes());
    const series = (await data('list.json')).results[0];
    const chapters = await data('chapters.json');
    const detail = await loadSource(source, fetchImpl).getDetail(`${B}/manga/${series.id}`);
    assert.equal(detail.title, series.title);
    assert.deepEqual(detail.authors, ['Yayoi Sou']);
    assert.deepEqual(detail.chapters.map((chapter) => chapter.number), [chapters[2].number, chapters[1].number, chapters[0].number]);
    assert.equal(detail.chapters[2].url, `${B}/chapters/${chapters[0].id}#${series.id}|${chapters[0].version}|${chapters[0].length}`);
    assert.equal(detail.chapters[2].title, `Chapter ${chapters[0].number} - ${chapters[0].name}`);
    assert.match(detail.chapters[1].title, /^Vol 3 Chapter /);
  });

  it('builds page links with the series id, from the page count', async () => {
    const pages = await loadSource(source, async () => { throw new Error('no request expected'); })
      .getPages(`${B}/chapters/711bf091-8b44-4abd-8b42-f87da822ef76#79141782-bc73-44fe-a1b2-eff842ca6123|2|3`);
    assert.deepEqual(pages.map((page) => page.url), [1, 2, 3].map((n) => `${API}/media/79141782-bc73-44fe-a1b2-eff842ca6123/711bf091-8b44-4abd-8b42-f87da822ef76/${n}.jpg?version=2`));
  });
});
