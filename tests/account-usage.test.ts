import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampUsagePercent,
  formatDurationFromSeconds,
  formatRelativeTime,
  formatUsageWindowReset,
  getAccountUsageWindows,
} from '../src/lib/account-usage';

describe('account usage formatting', () => {
  it('extracts Codex 5h and 7d usage windows from account extra fields', () => {
    const windows = getAccountUsageWindows({
      extra: {
        codex_5h_used_percent: 2,
        codex_5h_reset_after_seconds: 8_400,
        codex_5h_reset_at: '2026-05-31T17:30:42+08:00',
        codex_5h_window_minutes: 300,
        codex_7d_used_percent: 100,
        codex_7d_reset_after_seconds: 540_000,
        codex_7d_window_minutes: 10_080,
      },
    });

    assert.deepEqual(windows, [
      {
        key: '5h',
        label: '5h',
        percent: 2,
        resetAfterSeconds: 8_400,
        resetAt: '2026-05-31T17:30:42+08:00',
        windowMinutes: 300,
      },
      {
        key: '7d',
        label: '7d',
        percent: 100,
        resetAfterSeconds: 540_000,
        resetAt: undefined,
        windowMinutes: 10_080,
      },
    ]);
  });

  it('clamps usage percentages to the display range', () => {
    assert.equal(clampUsagePercent(-4), 0);
    assert.equal(clampUsagePercent(101.2), 100);
    assert.equal(clampUsagePercent('28.6'), 29);
    assert.equal(clampUsagePercent('bad'), undefined);
  });

  it('formats usage reset durations compactly', () => {
    assert.equal(formatDurationFromSeconds(8_400), '2h 20m');
    assert.equal(formatDurationFromSeconds(540_000), '6d 6h');
    assert.equal(formatDurationFromSeconds(40), '0m');
    assert.equal(formatUsageWindowReset({ resetAt: '2026-05-31T13:30:00+08:00' }, new Date('2026-05-31T12:00:00+08:00').getTime()), '1h 30m');
  });

  it('formats last usage as relative time', () => {
    const now = new Date('2026-05-31T12:00:00+08:00').getTime();

    assert.equal(formatRelativeTime('2026-05-31T11:37:00+08:00', now), '23分钟前');
    assert.equal(formatRelativeTime('2026-05-31T06:40:00+08:00', now), '5小时前');
    assert.equal(formatRelativeTime('2026-05-28T12:00:00+08:00', now), '3天前');
    assert.equal(formatRelativeTime(null, now), '--');
    assert.equal(formatRelativeTime('not-a-date', now), '--');
  });
});
