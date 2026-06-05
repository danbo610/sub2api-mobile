import type { AdminAccount } from '@/src/types/admin';

export type AccountUsageWindowKey = '5h' | '7d';

export type AccountUsageWindow = {
  key: AccountUsageWindowKey;
  label: string;
  percent: number;
  resetAfterSeconds?: number;
  resetAt?: string;
  windowMinutes?: number;
};

export type AccountUsageProgress = {
  utilization?: number | null;
  remaining_seconds?: number | null;
  resets_at?: string | null;
};

export type AccountUsageInfo = {
  source?: 'passive' | 'active';
  updated_at?: string | null;
  five_hour?: AccountUsageProgress | null;
  seven_day?: AccountUsageProgress | null;
  error?: string | null;
};

export type AccountUsageWindowTone = 'ok' | 'warning' | 'limited';

export const ACCOUNT_USAGE_WARNING_PERCENT = 80;

type AccountExtra = NonNullable<AdminAccount['extra']>;

const WINDOW_CONFIG: Array<{
  key: AccountUsageWindowKey;
  label: string;
  prefix: 'codex_5h' | 'codex_7d';
}> = [
  { key: '5h', label: '5h', prefix: 'codex_5h' },
  { key: '7d', label: '7d', prefix: 'codex_7d' },
];

function getFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }

  return undefined;
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function clampUsagePercent(value: unknown) {
  const percent = getFiniteNumber(value);

  if (percent === undefined) {
    return undefined;
  }

  return Math.min(Math.max(Math.round(percent), 0), 100);
}

export function getAccountUsageWindows(account: Pick<AdminAccount, 'extra'>): AccountUsageWindow[] {
  const extra = account.extra || {};

  return WINDOW_CONFIG.flatMap(({ key, label, prefix }) => {
    const percent = clampUsagePercent((extra as AccountExtra)[`${prefix}_used_percent`]);

    if (percent === undefined) {
      return [];
    }

    return [{
      key,
      label,
      percent,
      resetAfterSeconds: getFiniteNumber((extra as AccountExtra)[`${prefix}_reset_after_seconds`]),
      resetAt: getString((extra as AccountExtra)[`${prefix}_reset_at`]),
      windowMinutes: getFiniteNumber((extra as AccountExtra)[`${prefix}_window_minutes`]),
    }];
  });
}

function usageProgressToWindow(key: AccountUsageWindowKey, label: string, progress?: AccountUsageProgress | null): AccountUsageWindow | null {
  const percent = clampUsagePercent(progress?.utilization);

  if (percent === undefined) {
    return null;
  }

  return {
    key,
    label,
    percent,
    resetAfterSeconds: getFiniteNumber(progress?.remaining_seconds),
    resetAt: getString(progress?.resets_at),
  };
}

export function getAccountUsageWindowsFromUsageInfo(usage?: AccountUsageInfo | null): AccountUsageWindow[] {
  if (!usage) {
    return [];
  }

  return [
    usageProgressToWindow('5h', '5h', usage.five_hour),
    usageProgressToWindow('7d', '7d', usage.seven_day),
  ].filter((window): window is AccountUsageWindow => Boolean(window));
}

export function isUsageWindowLimited(window: Pick<AccountUsageWindow, 'percent'>) {
  return window.percent >= 100;
}

export function getUsageWindowTone(window: Pick<AccountUsageWindow, 'percent'>): AccountUsageWindowTone {
  if (isUsageWindowLimited(window)) {
    return 'limited';
  }

  if (window.percent >= ACCOUNT_USAGE_WARNING_PERCENT) {
    return 'warning';
  }

  return 'ok';
}

export function isAccountUsageLimited(account: Pick<AdminAccount, 'extra'>) {
  return getAccountUsageWindows(account).some(isUsageWindowLimited);
}

export function formatDurationFromSeconds(totalSeconds?: number) {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return '--';
  }

  const seconds = Math.max(Math.round(totalSeconds), 0);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return '0m';
}

export function getSecondsUntil(value?: string | null, now = Date.now()) {
  if (!value) {
    return undefined;
  }

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) {
    return undefined;
  }

  return Math.max(Math.round((time - now) / 1000), 0);
}

export function formatUsageWindowReset(window: Pick<AccountUsageWindow, 'resetAfterSeconds' | 'resetAt'>, now = Date.now()) {
  return formatDurationFromSeconds(window.resetAfterSeconds ?? getSecondsUntil(window.resetAt, now));
}

export function formatRelativeTime(value?: string | null, now = Date.now()) {
  if (!value) {
    return '--';
  }

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) {
    return '--';
  }

  const diffSeconds = Math.round((now - time) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const suffix = diffSeconds >= 0 ? '前' : '后';

  if (absSeconds < 60) {
    return `刚刚`;
  }

  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟${suffix}`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}小时${suffix}`;
  }

  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}天${suffix}`;
  }

  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months}个月${suffix}`;
  }

  return `${Math.round(months / 12)}年${suffix}`;
}
