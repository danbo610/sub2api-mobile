import type { AdminApiKey } from '@/src/types/admin';

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
