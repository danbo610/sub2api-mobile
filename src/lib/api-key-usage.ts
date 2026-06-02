import type { AdminApiKey, TrendPoint } from '@/src/types/admin';

export const API_KEY_USAGE_BATCH_SIZE = 10;

export type ApiKeyUsageRangeKey = 'today' | '24h' | '7d' | '30d';

export type ApiKeyUsageRange = {
  start_date: string;
  end_date: string;
  granularity: 'day' | 'hour';
};

export type UsageMetricTotals = {
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

export type ApiKeyUsageDailyRow = UsageMetricTotals & {
  date: string;
};

const emptyUsageTotals: UsageMetricTotals = {
  requests: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
};

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatDateParam(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateParam(value: string) {
  const [year, month, day] = value.split('-').map((part) => Number(part));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function normalizeTrendDate(value: string) {
  return value.slice(0, 10) || value;
}

export function createEmptyUsageTotals(): UsageMetricTotals {
  return { ...emptyUsageTotals };
}

export function addUsageTotals(left: UsageMetricTotals, right: UsageMetricTotals): UsageMetricTotals {
  return {
    requests: left.requests + right.requests,
    inputTokens: left.inputTokens + right.inputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: left.cost + right.cost,
  };
}

export function trendPointToUsageTotals(point: TrendPoint): UsageMetricTotals {
  return {
    requests: toNumber(point.requests),
    inputTokens: toNumber(point.input_tokens),
    cacheReadTokens: toNumber(point.cache_read_tokens),
    outputTokens: toNumber(point.output_tokens),
    totalTokens: toNumber(point.total_tokens),
    cost: toNumber(point.cost ?? point.actual_cost),
  };
}

export function aggregateTrendPoints(points: TrendPoint[]): UsageMetricTotals {
  return points.reduce((total, point) => addUsageTotals(total, trendPointToUsageTotals(point)), createEmptyUsageTotals());
}

export function buildDailyUsageRows(points: TrendPoint[], startDate: string, endDate: string): ApiKeyUsageDailyRow[] {
  const totalsByDate = new Map<string, UsageMetricTotals>();

  points.forEach((point) => {
    const date = normalizeTrendDate(point.date);
    const current = totalsByDate.get(date) ?? createEmptyUsageTotals();
    totalsByDate.set(date, addUsageTotals(current, trendPointToUsageTotals(point)));
  });

  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);

  if (!start || !end || start.getTime() > end.getTime()) {
    return [...totalsByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, totals]) => ({ date, ...totals }));
  }

  const rows: ApiKeyUsageDailyRow[] = [];
  const current = new Date(start);

  while (current.getTime() <= end.getTime()) {
    const date = formatDateParam(current);
    rows.push({ date, ...(totalsByDate.get(date) ?? createEmptyUsageTotals()) });
    current.setDate(current.getDate() + 1);
  }

  return rows;
}

export function getApiKeyUsageDateRange(rangeKey: ApiKeyUsageRangeKey, now = new Date()): ApiKeyUsageRange {
  const end = new Date(now);
  const start = new Date(now);

  if (rangeKey === '24h') {
    start.setHours(end.getHours() - 23, 0, 0, 0);
  } else if (rangeKey === '30d') {
    start.setDate(end.getDate() - 29);
  } else if (rangeKey === '7d') {
    start.setDate(end.getDate() - 6);
  }

  return {
    start_date: formatDateParam(start),
    end_date: formatDateParam(end),
    granularity: rangeKey === '24h' ? 'hour' : 'day',
  };
}

export function getTopApiKeyUsageRows<T extends UsageMetricTotals>(rows: T[], limit = 20) {
  return [...rows]
    .sort((left, right) => {
      const costDiff = right.cost - left.cost;
      if (costDiff !== 0) return costDiff;

      const requestDiff = right.requests - left.requests;
      if (requestDiff !== 0) return requestDiff;

      return right.totalTokens - left.totalTokens;
    })
    .slice(0, limit);
}

export function formatReasoningEffort(effort?: string | null) {
  const raw = String(effort ?? '').trim();
  if (!raw) return '--';

  const normalized = raw.toLowerCase().replace(/[-_\s]/g, '');

  switch (normalized) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
    case 'extrahigh':
      return 'XHigh';
    case 'max':
      return 'Max';
    case 'none':
    case 'minimal':
      return '--';
    default:
      return raw.length > 1 ? `${raw[0].toUpperCase()}${raw.slice(1)}` : raw.toUpperCase();
  }
}

export function formatIpLocation(input?: {
  ip_location?: string | null;
  country?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
} | null) {
  if (!input) return '--';

  const direct = input.ip_location?.trim();
  if (direct) return direct;

  const parts = [input.country, input.region]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value!.trim());

  if (parts.length > 0) {
    return parts.join('/');
  }

  return '--';
}

export function toTimeValue(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortApiKeysByLastUsedDesc<T extends Pick<AdminApiKey, 'last_used_at' | 'updated_at'>>(items: T[]) {
  return [...items].sort((left, right) => {
    const lastUsedDiff = toTimeValue(right.last_used_at) - toTimeValue(left.last_used_at);
    if (lastUsedDiff !== 0) return lastUsedDiff;
    return toTimeValue(right.updated_at) - toTimeValue(left.updated_at);
  });
}
