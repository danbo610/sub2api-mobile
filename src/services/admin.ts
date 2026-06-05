import { buildAdminRequestUrl, adminFetch } from '@/src/lib/admin-fetch';
import { parseAccountTestResponse } from '@/src/lib/account-test';
import type { AccountUsageInfo } from '@/src/lib/account-usage';
import { adminConfigState } from '@/src/store/admin-config';
import type {
  AccountTodayStats,
  AdminAccount,
  AdminAccountModel,
  AdminApiKey,
  AdminGroup,
  AdminSettings,
  AdminUsageLog,
  AdminUser,
  BalanceOperation,
  DashboardModelStats,
  DashboardSnapshot,
  DashboardStats,
  DashboardTrend,
  CreateAccountRequest,
  CreateUserRequest,
  OpenAIOAuthAuthUrlResponse,
  OpenAIOAuthTokenInfo,
  PaginatedData,
  UsageStats,
  UserUsageSummary,
} from '@/src/types/admin';

function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const value = query.toString();

  return value ? `?${value}` : '';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'REQUEST_FAILED';
}

export function getDashboardStats() {
  return adminFetch<DashboardStats>('/api/v1/admin/dashboard/stats');
}

export function getAdminSettings() {
  return adminFetch<AdminSettings>('/api/v1/admin/settings');
}

export function getDashboardTrend(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  group_id?: number;
  user_id?: number;
}) {
  return adminFetch<DashboardTrend>(`/api/v1/admin/dashboard/trend${buildQuery(params)}`);
}

export function getDashboardModels(params: { start_date: string; end_date: string }) {
  return adminFetch<DashboardModelStats>(`/api/v1/admin/dashboard/models${buildQuery(params)}`);
}

export function getDashboardSnapshot(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  api_key_id?: number;
  user_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
  include_stats?: boolean;
  include_trend?: boolean;
  include_model_stats?: boolean;
  include_group_stats?: boolean;
  include_users_trend?: boolean;
}) {
  return adminFetch<DashboardSnapshot>(`/api/v1/admin/dashboard/snapshot-v2${buildQuery(params)}`);
}

export function getUsageStats(params: {
  start_date: string;
  end_date: string;
  user_id?: number;
  api_key_id?: number;
  account_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
}) {
  return adminFetch<UsageStats>(`/api/v1/admin/usage/stats${buildQuery(params)}`);
}

export function listAdminUsageLogs(params: {
  page?: number;
  page_size?: number;
  user_id?: number;
  api_key_id?: number;
  account_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
  billing_mode?: string | null;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  exact_total?: boolean;
}) {
  return adminFetch<PaginatedData<AdminUsageLog>>(
    `/api/v1/admin/usage${buildQuery({
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      user_id: params.user_id,
      api_key_id: params.api_key_id,
      account_id: params.account_id,
      group_id: params.group_id,
      model: params.model,
      request_type: params.request_type,
      billing_type: params.billing_type,
      billing_mode: params.billing_mode,
      start_date: params.start_date,
      end_date: params.end_date,
      timezone: params.timezone,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
      exact_total: params.exact_total,
    })}`
  );
}

export async function getLatestApiKeyUsageLog(params: { userId: number; apiKeyId: number }) {
  const result = await listAdminUsageLogs({
    page: 1,
    page_size: 1,
    user_id: params.userId,
    api_key_id: params.apiKeyId,
    sort_by: 'created_at',
    sort_order: 'desc',
    exact_total: false,
  });

  return result.items?.[0] ?? null;
}

export type ApiKeyUsageSummary = {
  apiKeyId: number;
  today?: UsageStats;
  month?: UsageStats;
  todayError?: string;
  monthError?: string;
};

export async function getApiKeyUsageSummary(params: {
  userId: number;
  apiKeyId: number;
  todayRange: { start_date: string; end_date: string };
  monthRange: { start_date: string; end_date: string };
}): Promise<ApiKeyUsageSummary> {
  const snapshotResult = await Promise.allSettled([
    getDashboardSnapshot({
      ...params.monthRange,
      granularity: 'day',
      user_id: params.userId,
      api_key_id: params.apiKeyId,
      include_stats: true,
      include_trend: true,
      include_model_stats: false,
      include_group_stats: false,
      include_users_trend: false,
    }),
  ]);

  const snapshot = snapshotResult[0];

  if (snapshot.status === 'fulfilled') {
    const todayPoint = snapshot.value.trend?.find((item) => item.date.startsWith(params.todayRange.end_date));
    const monthCost = snapshot.value.trend?.reduce((sum, item) => sum + Number(item.cost ?? item.actual_cost ?? 0), 0) ?? 0;

    return {
      apiKeyId: params.apiKeyId,
      today: { total_account_cost: Number(todayPoint?.cost ?? todayPoint?.actual_cost ?? 0) },
      month: { total_account_cost: monthCost },
    };
  }

  return {
    apiKeyId: params.apiKeyId,
    todayError: getErrorMessage(snapshot.reason),
    monthError: getErrorMessage(snapshot.reason),
  };
}

export function listUsers(search = '') {
  return adminFetch<PaginatedData<AdminUser>>(
    `/api/v1/admin/users${buildQuery({ page: 1, page_size: 20, search: search.trim() })}`
  );
}

export function listUsersPage(params: { page?: number; page_size?: number; search?: string } = {}) {
  return adminFetch<PaginatedData<AdminUser>>(
    `/api/v1/admin/users${buildQuery({
      page: params.page ?? 1,
      page_size: params.page_size ?? 1000,
      search: params.search?.trim(),
    })}`
  );
}

export function listApiKeys(params: { page?: number; page_size?: number; search?: string; status?: string } = {}) {
  return adminFetch<PaginatedData<AdminApiKey>>(
    `/api/v1/keys${buildQuery({
      page: params.page ?? 1,
      page_size: params.page_size ?? 1000,
      search: params.search?.trim(),
      status: params.status,
    })}`
  );
}

export async function listAllApiKeys(params: { search?: string; status?: string } = {}) {
  const firstPage = await listApiKeys({ ...params, page: 1, page_size: 1000 });
  const items = [...(firstPage.items ?? [])];
  const pages = Math.max(Number(firstPage.pages ?? 1), 1);

  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await listApiKeys({ ...params, page, page_size: 1000 });
    items.push(...(nextPage.items ?? []));
  }

  return items;
}

export async function listAllUserApiKeysFallback() {
  const firstPage = await listUsersPage({ page: 1, page_size: 1000 });
  const users = [...(firstPage.items ?? [])];
  const pages = Math.max(Number(firstPage.pages ?? 1), 1);

  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await listUsersPage({ page, page_size: 1000 });
    users.push(...(nextPage.items ?? []));
  }

  const keyPages = await Promise.all(
    users.map(async (user) => {
      const result = await listUserApiKeys(user.id);
      return (result.items ?? []).map((item) => ({
        ...item,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      }));
    })
  );

  return keyPages.flat();
}

export function getUser(userId: number) {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`);
}

export function createUser(body: CreateUserRequest) {
  return adminFetch<AdminUser>('/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getUserUsage(userId: number, period: 'day' | 'week' | 'month' = 'month') {
  return adminFetch<UserUsageSummary>(`/api/v1/admin/users/${userId}/usage${buildQuery({ period })}`);
}

export function listUserApiKeys(userId: number) {
  return adminFetch<PaginatedData<AdminApiKey>>(`/api/v1/admin/users/${userId}/api-keys${buildQuery({ page: 1, page_size: 1000 })}`);
}

export function updateUserBalance(
  userId: number,
  body: { balance: number; operation: BalanceOperation; notes?: string }
) {
  return adminFetch<AdminUser>(
    `/api/v1/admin/users/${userId}/balance`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    {
      idempotencyKey: `user-balance-${userId}-${Date.now()}`,
    }
  );
}

export function updateUserStatus(userId: number, status: 'active' | 'disabled') {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function listGroups(search = '') {
  return adminFetch<PaginatedData<AdminGroup>>(
    `/api/v1/admin/groups${buildQuery({ page: 1, page_size: 20, search: search.trim() })}`
  );
}

export function getGroup(groupId: number) {
  return adminFetch<AdminGroup>(`/api/v1/admin/groups/${groupId}`);
}

export function listAccountsPage(params: { page?: number; page_size?: number; search?: string } = {}) {
  return adminFetch<PaginatedData<AdminAccount>>(
    `/api/v1/admin/accounts${buildQuery({
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      search: params.search?.trim(),
    })}`
  );
}

export function listAccounts(search = '') {
  return listAccountsPage({ page: 1, page_size: 20, search });
}

export async function listAllAccounts(search = '') {
  const firstPage = await listAccountsPage({ page: 1, page_size: 1000, search });
  const items = [...(firstPage.items ?? [])];
  const pages = Math.max(Number(firstPage.pages ?? 1), 1);

  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await listAccountsPage({ page, page_size: 1000, search });
    items.push(...(nextPage.items ?? []));
  }

  return items;
}

export function getAccount(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}`);
}

export function getAccountAvailableModels(accountId: number) {
  return adminFetch<AdminAccountModel[]>(`/api/v1/admin/accounts/${accountId}/models`);
}

export function generateOpenAIAuthUrl(params: { proxy_id?: number | null; redirect_uri?: string } = {}) {
  const body: Record<string, string | number> = {};

  if (params.proxy_id) {
    body.proxy_id = params.proxy_id;
  }
  if (params.redirect_uri) {
    body.redirect_uri = params.redirect_uri;
  }

  return adminFetch<OpenAIOAuthAuthUrlResponse>('/api/v1/admin/openai/generate-auth-url', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function exchangeOpenAIAuthCode(params: {
  session_id: string;
  code: string;
  state: string;
  proxy_id?: number | null;
  redirect_uri?: string;
}) {
  const body: Record<string, string | number> = {
    session_id: params.session_id,
    code: params.code,
    state: params.state,
  };

  if (params.proxy_id) {
    body.proxy_id = params.proxy_id;
  }
  if (params.redirect_uri) {
    body.redirect_uri = params.redirect_uri;
  }

  return adminFetch<OpenAIOAuthTokenInfo>('/api/v1/admin/openai/exchange-code', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function applyOAuthCredentials(
  accountId: number,
  body: {
    type: 'oauth' | 'setup-token';
    credentials: Record<string, unknown>;
    extra?: Record<string, unknown>;
  }
) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/apply-oauth-credentials`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function createAccount(body: CreateAccountRequest) {
  return adminFetch<AdminAccount>('/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getAccountTodayStats(accountId: number) {
  return adminFetch<AccountTodayStats>(`/api/v1/admin/accounts/${accountId}/today-stats`);
}

export function getAccountUsage(accountId: number, source: 'passive' | 'active' = 'active', force = false) {
  return adminFetch<AccountUsageInfo>(
    `/api/v1/admin/accounts/${accountId}/usage${buildQuery({
      source,
      force,
    })}`
  );
}

function getDefaultTestModel(account: Pick<AdminAccount, 'platform'>, models: AdminAccountModel[]) {
  if (models.length === 0) {
    return undefined;
  }

  if (account.platform === 'gemini') {
    return models[0];
  }

  return models.find((model) => model.id.includes('sonnet')) ?? models[0];
}

export async function testAccount(account: Pick<AdminAccount, 'id' | 'platform'>) {
  const baseUrl = adminConfigState.baseUrl.trim().replace(/\/$/, '');
  const adminApiKey = adminConfigState.adminApiKey.trim();

  if (!baseUrl) {
    throw new Error('BASE_URL_REQUIRED');
  }

  if (!adminApiKey) {
    throw new Error('ADMIN_API_KEY_REQUIRED');
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('x-api-key', adminApiKey);

  const models = await getAccountAvailableModels(account.id);
  const selectedModel = getDefaultTestModel(account, models);

  return fetch(buildAdminRequestUrl(baseUrl, `/api/v1/admin/accounts/${account.id}/test`), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_id: selectedModel?.id ?? '',
      prompt: '',
    }),
  }).then(async (response) => {
    const text = await response.text();
    const result = parseAccountTestResponse({
      text,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
    });

    return {
      ...result,
      selectedModelId: selectedModel?.id,
      selectedModelName: selectedModel?.display_name ?? selectedModel?.id,
    };
  });
}

export function refreshAccount(accountId: number) {
  return adminFetch(`/api/v1/admin/accounts/${accountId}/refresh`, {
    method: 'POST',
  });
}

export function setAccountSchedulable(accountId: number, schedulable: boolean) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/schedulable`, {
    method: 'POST',
    body: JSON.stringify({ schedulable }),
  });
}
