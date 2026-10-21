import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { build } from '../build/build.mjs';

describe('build', () => {
  it('writes an index Otavue can read, with the hash of each exact file', async () => {
    const out = join(tmpdir(), `otavue-extensions-build-${process.pid}`);
    const index = await build(out);
    assert.equal(index.name, 'Otavue Extensions');
    assert.deepEqual(index.extractors, []);
    for (const source of index.sources) {
      assert.match(source.id, /^[A-Za-z0-9_.-]{1,48}$/);
      assert.ok(['anime', 'manga'].includes(source.type));
      assert.match(source.version, /^\d+\.\d+\.\d+\.\d+$/);
      const text = await readFile(join(out, source.file), 'utf8');
      assert.equal(source.sha256, createHash('sha256').update(text, 'utf8').digest('hex'));
      assert.ok(text.startsWith(`// ${source.name} (${source.id} `));
      assert.match(text, /\nvar SITE = \{"id":/);
    }
    const written = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
    assert.deepEqual(written, index);
    assert.ok(index.sources.some((source) => source.id === 'mangadex.en' && source.nsfw === false));
  });
});
