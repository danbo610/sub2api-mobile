import type { AdminAccount } from '@/src/types/admin';
import { isAccountUsageLimited } from './account-usage';

export type AccountStatusFilter = 'all' | 'active' | 'limited' | 'paused' | 'error';

export type AccountVisualStatus = {
  filterKey: AccountStatusFilter;
  label: '正常' | '限流' | '暂停' | '异常';
  badgeTone: 'success' | 'muted' | 'danger';
};

export function getAccountError(account: Pick<AdminAccount, 'status' | 'error_message'>) {
  return Boolean(`${account.status ?? ''}`.toLowerCase() === 'error' || account.error_message);
}

export function getAccountErrorMessage(account: Pick<AdminAccount, 'status' | 'error_message'>) {
  if (account.error_message) {
    return account.error_message;
  }

  return getAccountError(account) ? '账号状态异常，后台未返回详细原因' : '';
}

export function getAccountVisualStatus(
  account: Pick<AdminAccount, 'status' | 'error_message' | 'schedulable' | 'extra'>
): AccountVisualStatus {
  const normalizedStatus = `${account.status ?? ''}`.toLowerCase();
  const isPausedStatus = ['inactive', 'disabled', 'paused', 'stop', 'stopped'].includes(normalizedStatus);

  if (isAccountUsageLimited(account)) {
    return { filterKey: 'limited', label: '限流', badgeTone: 'danger' };
  }

  if (getAccountError(account)) {
    return { filterKey: 'error', label: '异常', badgeTone: 'danger' };
  }

  if (isPausedStatus || account.schedulable === false) {
    return { filterKey: 'paused', label: '暂停', badgeTone: 'muted' };
  }

  return { filterKey: 'active', label: '正常', badgeTone: 'success' };
}
