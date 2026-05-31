import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sortApiKeysByLastUsedDesc, toTimeValue } from '../src/lib/api-key-usage';

describe('api key usage helpers', () => {
  it('sorts API keys by last used time descending with unused keys last', () => {
    const sorted = sortApiKeysByLastUsedDesc([
      { id: 1, last_used_at: null, updated_at: '2026-05-31T15:00:00+08:00' },
      { id: 2, last_used_at: '2026-05-31T14:58:00+08:00', updated_at: '2026-05-31T14:58:00+08:00' },
      { id: 3, last_used_at: '2026-05-31T14:58:19+08:00', updated_at: '2026-05-31T14:58:19+08:00' },
      { id: 4, last_used_at: null, updated_at: '2026-05-30T15:00:00+08:00' },
    ]);

    assert.deepEqual(sorted.map((item) => item.id), [3, 2, 1, 4]);
  });

  it('parses invalid or empty timestamps as zero', () => {
    assert.equal(toTimeValue(null), 0);
    assert.equal(toTimeValue('not-a-date'), 0);
    assert.ok(toTimeValue('2026-05-31T14:58:19+08:00') > 0);
  });
});
