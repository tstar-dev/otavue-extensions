import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareVersions, versionProblems } from '../tools/check-versions.mjs';

const index = (...sources) => ({ sources: sources.map(([id, version, sha256]) => ({ id, version, sha256 })) });

describe('version check', () => {
  it('compares versions number by number', () => {
    assert.equal(compareVersions('1.0.10.1', '1.0.9.1'), 1);
    assert.equal(compareVersions('1.0.2.1', '1.0.2.1'), 0);
    assert.equal(compareVersions('1.0.1.1', '1.0.2.0'), -1);
  });

  it('passes unchanged files, and changed files with a new version', () => {
    const published = index(['a.one', '1.0.0.1', 'aaa'], ['a.two', '1.0.0.1', 'bbb']);
    const built = index(['a.one', '1.0.0.1', 'aaa'], ['a.two', '1.0.1.1', 'ccc']);
    assert.deepEqual(versionProblems(published, built), []);
  });

  it('fails a changed file under the same version', () => {
    const problems = versionProblems(index(['a.one', '1.0.0.1', 'aaa']), index(['a.one', '1.0.0.1', 'bbb']));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^a\.one: the file changed but the version is still 1\.0\.0\.1/);
  });

  it('fails a version that went down, even with the same file', () => {
    const problems = versionProblems(index(['a.one', '1.0.2.1', 'aaa']), index(['a.one', '1.0.1.1', 'aaa']));
    assert.deepEqual(problems, ['a.one: version went down (1.0.2.1 → 1.0.1.1)']);
  });

  it('ignores new and removed sources', () => {
    assert.deepEqual(versionProblems(index(['a.gone', '1.0.0.1', 'aaa']), index(['a.new', '1.0.0.1', 'bbb'])), []);
  });
});
