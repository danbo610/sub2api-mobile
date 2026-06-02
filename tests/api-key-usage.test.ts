import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateTrendPoints,
  buildDailyUsageRows,
  getApiKeyUsageDateRange,
  getApiKeyDailyLimitProgress,
  getTopApiKeyUsageRows,
  formatIpLocation,
  formatReasoningEffort,
  sortApiKeysByLastUsedDesc,
  toTimeValue,
} from '../src/lib/api-key-usage';
import { formatDisplayTime } from '../src/lib/formatters';
import type { TrendPoint } from '../src/types/admin';

function trendPoint(input: Partial<TrendPoint> & Pick<TrendPoint, 'date'>): TrendPoint {
  return {
    date: input.date,
    requests: input.requests ?? 0,
    input_tokens: input.input_tokens ?? 0,
    output_tokens: input.output_tokens ?? 0,
    cache_creation_tokens: input.cache_creation_tokens ?? 0,
    cache_read_tokens: input.cache_read_tokens ?? 0,
    total_tokens: input.total_tokens ?? 0,
    cost: input.cost ?? 0,
    actual_cost: input.actual_cost ?? 0,
  };
}

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

  it('aggregates trend points into display totals', () => {
    const totals = aggregateTrendPoints([
      trendPoint({
        date: '2026-05-30',
        requests: 2,
        input_tokens: 100,
        cache_read_tokens: 20,
        output_tokens: 50,
        total_tokens: 170,
        cost: 0.2,
      }),
      trendPoint({
        date: '2026-05-31',
        requests: 3,
        input_tokens: 200,
        cache_read_tokens: 30,
        output_tokens: 70,
        total_tokens: 300,
        cost: 0.35,
      }),
    ]);

    assert.deepEqual(totals, {
      requests: 5,
      inputTokens: 300,
      cacheReadTokens: 50,
      outputTokens: 120,
      totalTokens: 470,
      cost: 0.55,
    });
  });

  it('builds daily rows and fills dates with zero usage', () => {
    const rows = buildDailyUsageRows(
      [
        trendPoint({ date: '2026-05-29T12:00:00+08:00', requests: 1, total_tokens: 10, cost: 0.01 }),
        trendPoint({ date: '2026-05-31', requests: 4, total_tokens: 40, cost: 0.04 }),
      ],
      '2026-05-29',
      '2026-05-31'
    );

    assert.deepEqual(
      rows.map((row) => ({ date: row.date, requests: row.requests, totalTokens: row.totalTokens, cost: row.cost })),
      [
        { date: '2026-05-29', requests: 1, totalTokens: 10, cost: 0.01 },
        { date: '2026-05-30', requests: 0, totalTokens: 0, cost: 0 },
        { date: '2026-05-31', requests: 4, totalTokens: 40, cost: 0.04 },
      ]
    );
  });

  it('builds ranking ranges from local calendar dates', () => {
    const now = new Date(2026, 4, 31, 15, 20, 0);

    assert.deepEqual(getApiKeyUsageDateRange('today', now), {
      start_date: '2026-05-31',
      end_date: '2026-05-31',
      granularity: 'day',
    });
    assert.deepEqual(getApiKeyUsageDateRange('7d', now), {
      start_date: '2026-05-25',
      end_date: '2026-05-31',
      granularity: 'day',
    });
    assert.deepEqual(getApiKeyUsageDateRange('30d', now), {
      start_date: '2026-05-02',
      end_date: '2026-05-31',
      granularity: 'day',
    });
    assert.equal(getApiKeyUsageDateRange('24h', now).granularity, 'hour');
  });

  it('builds API key daily limit progress from today cost', () => {
    assert.equal(getApiKeyDailyLimitProgress({ rate_limit_1d: 0 }, 45.04), null);

    assert.deepEqual(getApiKeyDailyLimitProgress({ rate_limit_1d: 100 }, 45.04), {
      limit: 100,
      used: 45.04,
      percent: 45.04,
      cappedPercent: 45.04,
      warning: false,
      exceeded: false,
    });

    assert.deepEqual(getApiKeyDailyLimitProgress({ rate_limit_1d: 100 }, 90), {
      limit: 100,
      used: 90,
      percent: 90,
      cappedPercent: 90,
      warning: true,
      exceeded: false,
    });

    assert.deepEqual(getApiKeyDailyLimitProgress({ rate_limit_1d: 100 }, 100), {
      limit: 100,
      used: 100,
      percent: 100,
      cappedPercent: 100,
      warning: false,
      exceeded: true,
    });

    assert.deepEqual(getApiKeyDailyLimitProgress({ rate_limit_1d: 100 }, 125), {
      limit: 100,
      used: 125,
      percent: 125,
      cappedPercent: 100,
      warning: false,
      exceeded: true,
    });
  });

  it('sorts top API key usage rows by total cost descending', () => {
    const rows = getTopApiKeyUsageRows(
      [
        { id: 1, requests: 3, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 30, cost: 0.3 },
        { id: 2, requests: 4, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 20, cost: 0.5 },
        { id: 3, requests: 8, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 80, cost: 0.5 },
      ],
      2
    );

    assert.deepEqual(rows.map((row) => row.id), [3, 2]);
  });

  it('formats reasoning effort consistently with the native admin UI labels', () => {
    assert.equal(formatReasoningEffort('low'), 'Low');
    assert.equal(formatReasoningEffort('extra-high'), 'XHigh');
    assert.equal(formatReasoningEffort('minimal'), '--');
    assert.equal(formatReasoningEffort('custom'), 'Custom');
  });

  it('formats IP location from direct value or location parts', () => {
    assert.equal(formatIpLocation({ ip_location: 'Japan / Tokyo' }), 'Japan / Tokyo');
    assert.equal(formatIpLocation({ country: 'US', region: 'California', city: 'San Jose' }), 'US/California');
    assert.equal(formatIpLocation({}), '--');
  });

  it('formats display time with seconds for account metadata', () => {
    assert.equal(formatDisplayTime('2026-05-02T00:53:56+08:00'), '2026/05/02 00:53:56');
    assert.equal(formatDisplayTime(null), '--');
  });
});
