import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Settings2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiKeyUsageRowCard } from '@/src/components/usage/api-key-usage-row-card';
import { formatRelativeTime } from '@/src/lib/account-usage';
import {
  API_KEY_USAGE_BATCH_SIZE,
  aggregateTrendPoints,
  createEmptyUsageTotals,
  getApiKeyGroupFilterKey,
  getApiKeyGroupId,
  getApiKeyGroupLabel,
  getApiKeyUsageDateRange,
  getTopApiKeyUsageRows,
  type ApiKeyUsageRange,
  type ApiKeyUsageRangeKey,
  type ApiKeyGroupFilterKey,
  type UsageMetricTotals,
} from '@/src/lib/api-key-usage';
import { formatCost, formatDisplayTime, formatInteger, formatTokenValue } from '@/src/lib/formatters';
import { getAccountTodayStats, getDashboardSnapshot, listAllAccounts, listAllApiKeys, listAllUserApiKeysFallback } from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import type { AdminAccount, AdminApiKey } from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

type RankingRangeKey = ApiKeyUsageRangeKey;
type RankingMode = 'api-key' | 'group';

type RankingRow = UsageMetricTotals & {
  apiKeyId: number;
  apiKeyName: string;
  userId: number;
  groupFilterKey: ApiKeyGroupFilterKey;
  groupId: number | null;
  groupLabel?: string;
  lastUsedText?: string;
};

type AccountGroupInfo = {
  key: ApiKeyGroupFilterKey;
  groupId: number | null;
  label: string;
};

type AccountRankingRow = UsageMetricTotals & {
  accountId: number;
  groups: AccountGroupInfo[];
};

type GroupRankingRow = UsageMetricTotals & {
  groupFilterKey: ApiKeyGroupFilterKey;
  groupId: number | null;
  groupLabel: string;
  aiAccountCount: number;
  apiKeyCount: number;
  activeApiKeyCount: number;
  lastUsedAt?: string;
  currentConcurrency: number;
  capacity: number;
};

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  muted: '#f1ece2',
  primary: '#1d5f55',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  dangerBg: '#fbf1eb',
  danger: '#c25d35',
  accentBg: '#efe4cf',
  accentText: '#8c5a22',
};

const RANGE_OPTIONS: Array<{ key: RankingRangeKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先到服务器页填写服务地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先到服务器页填写 Admin Token。';
      default:
        return error.message;
    }
  }

  return '当前无法加载排行榜数据，请检查服务地址、Token 和网络。';
}

function getApiKeyName(item: AdminApiKey) {
  return item.name?.trim() || item.key?.slice(0, 16) || `Key #${item.id}`;
}

function isApiKeyActiveWithin(apiKey: Pick<AdminApiKey, 'last_used_at'>, minutes: number, now = Date.now()) {
  if (!apiKey.last_used_at) return false;
  const time = new Date(apiKey.last_used_at).getTime();
  if (Number.isNaN(time)) return false;
  return now - time <= minutes * 60_000;
}

function getFiniteNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function getAccountGroupInfos(account: Pick<AdminAccount, 'groups'>): AccountGroupInfo[] {
  const groups = account.groups?.filter((group) => group.id && group.name?.trim()) ?? [];
  return groups.length > 0
    ? groups.map((group) => ({
      key: `group:${group.id}` as const,
      groupId: group.id,
      label: group.name.trim(),
    }))
    : [{ key: 'ungrouped', groupId: null, label: '未分组' }];
}

function addTotalsToGroup(row: GroupRankingRow, totals: UsageMetricTotals) {
  row.requests += totals.requests;
  row.inputTokens += totals.inputTokens;
  row.cacheReadTokens += totals.cacheReadTokens;
  row.outputTokens += totals.outputTokens;
  row.totalTokens += totals.totalTokens;
  row.cost += totals.cost;
}

async function loadAllApiKeys() {
  try {
    return await listAllApiKeys();
  } catch {
    return listAllUserApiKeysFallback();
  }
}

async function getApiKeyRankingRow(item: AdminApiKey, range: ApiKeyUsageRange): Promise<RankingRow> {
  const userId = Number(item.user?.id ?? item.user_id);
  const snapshot = await getDashboardSnapshot({
    ...range,
    user_id: Number.isFinite(userId) ? userId : undefined,
    api_key_id: item.id,
    include_stats: false,
    include_trend: true,
    include_model_stats: false,
    include_group_stats: false,
    include_users_trend: false,
  });
  const totals = aggregateTrendPoints(snapshot.trend ?? []);

  return {
    ...totals,
    apiKeyId: item.id,
    apiKeyName: getApiKeyName(item),
    userId,
    groupFilterKey: getApiKeyGroupFilterKey(item),
    groupId: getApiKeyGroupId(item),
    groupLabel: item.group?.name,
    lastUsedText: item.last_used_at ? formatDisplayTime(item.last_used_at) : undefined,
  };
}

async function getAccountRankingRow(account: AdminAccount, rangeKey: RankingRangeKey, range: ApiKeyUsageRange): Promise<AccountRankingRow> {
  if (rangeKey === 'today') {
    const stats = await getAccountTodayStats(account.id);

    return {
      requests: getFiniteNumber(stats.requests),
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: getFiniteNumber(stats.tokens),
      cost: getFiniteNumber(stats.cost),
      accountId: account.id,
      groups: getAccountGroupInfos(account),
    };
  }

  const snapshot = await getDashboardSnapshot({
    ...range,
    account_id: account.id,
    include_stats: false,
    include_trend: true,
    include_model_stats: false,
    include_group_stats: false,
    include_users_trend: false,
  });

  return {
    ...aggregateTrendPoints(snapshot.trend ?? []),
    accountId: account.id,
    groups: getAccountGroupInfos(account),
  };
}

function buildGroupRows(apiKeys: AdminApiKey[], accountRows: AccountRankingRow[], accounts: AdminAccount[]): GroupRankingRow[] {
  const now = Date.now();
  const groups = new Map<ApiKeyGroupFilterKey, GroupRankingRow>();

  function ensureGroup(key: ApiKeyGroupFilterKey, label?: string, groupId?: number | null) {
    const current = groups.get(key);
    if (current) {
      if (label && current.groupLabel === '未分组') current.groupLabel = label;
      return current;
    }

    const next: GroupRankingRow = {
      ...createEmptyUsageTotals(),
      groupFilterKey: key,
      groupId: groupId ?? (key.startsWith('group:') ? Number(key.replace('group:', '')) : null),
      groupLabel: label || (key === 'ungrouped' ? '未分组' : `分组${key.replace('group:', '')}`),
      aiAccountCount: 0,
      apiKeyCount: 0,
      activeApiKeyCount: 0,
      lastUsedAt: undefined,
      currentConcurrency: 0,
      capacity: 0,
    };
    groups.set(key, next);
    return next;
  }

  apiKeys.forEach((apiKey) => {
    const key = getApiKeyGroupFilterKey(apiKey);
    const groupId = getApiKeyGroupId(apiKey);
    const row = ensureGroup(key, groupId ? getApiKeyGroupLabel(apiKey, groupId) : '未分组', groupId);
    row.apiKeyCount += 1;
    if (apiKey.last_used_at) {
      const currentTime = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
      const nextTime = new Date(apiKey.last_used_at).getTime();
      if (!Number.isNaN(nextTime) && nextTime > currentTime) {
        row.lastUsedAt = apiKey.last_used_at;
      }
    }
    if (isApiKeyActiveWithin(apiKey, 5, now)) {
      row.activeApiKeyCount += 1;
    }
  });

  accounts.forEach((account) => {
    getAccountGroupInfos(account).forEach((group) => {
      const row = ensureGroup(group.key, group.label, group.groupId);
      row.aiAccountCount += 1;
      row.currentConcurrency += Number(account.current_concurrency ?? 0);
      row.capacity += Number(account.concurrency ?? 0);
    });
  });

  accountRows.forEach((accountRow) => {
    accountRow.groups.forEach((group) => {
      const row = ensureGroup(group.key, group.label, group.groupId);
      addTotalsToGroup(row, accountRow);
    });
  });

  return [...groups.values()]
    .sort((left, right) => {
      const costDiff = right.cost - left.cost;
      if (costDiff !== 0) return costDiff;
      const requestDiff = right.requests - left.requests;
      if (requestDiff !== 0) return requestDiff;
      return right.totalTokens - left.totalTokens;
    })
    .slice(0, 20);
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 96, backgroundColor: colors.muted, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12 }}>
      <Text style={{ fontSize: 11, color: colors.subtext }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 16, fontWeight: '800', color: accent ? colors.accentText : colors.text }}>
        {value}
      </Text>
    </View>
  );
}

function GroupMetricCell({
  label,
  value,
  accent,
  onPress,
}: {
  label: string;
  value: string;
  accent?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={{ fontSize: 11, color: colors.subtext }}>{label}</Text>
      <Text numberOfLines={2} style={{ marginTop: 5, fontSize: 14, fontWeight: '800', color: accent ? colors.accentText : colors.text }}>
        {value}
      </Text>
    </>
  );
  const style = {
    width: '31.5%' as const,
    minWidth: 92,
    backgroundColor: colors.muted,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: onPress ? colors.primary : colors.border,
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={style}>
        {content}
      </Pressable>
    );
  }

  return <View style={style}>{content}</View>;
}

function GroupRankingCard({ item, index }: { item: GroupRankingRow; index: number }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
            {item.groupLabel}
          </Text>
          <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 12, color: colors.subtext }}>
            当前并发 {formatInteger(item.currentConcurrency)} / {formatInteger(item.capacity)}
          </Text>
        </View>
        <View style={{ backgroundColor: colors.muted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.subtext }}>#{index}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <GroupMetricCell label="总成本" value={formatCost(item.cost)} accent />
        <GroupMetricCell label="总请求" value={formatInteger(item.requests)} />
        <GroupMetricCell label="总 Token" value={formatTokenValue(item.totalTokens)} />
        <GroupMetricCell
          label="AI账号数"
          value={formatInteger(item.aiAccountCount)}
          onPress={() =>
            router.push({
              pathname: '/accounts/overview',
              params: { group: item.groupFilterKey },
            })
          }
        />
        <GroupMetricCell
          label="活跃AK数/总数"
          value={`${formatInteger(item.activeApiKeyCount)} / ${formatInteger(item.apiKeyCount)}`}
          onPress={() =>
            router.push({
              pathname: '/api-keys',
              params: { group: item.groupFilterKey },
            })
          }
        />
        <GroupMetricCell label="最后使用时间" value={formatRelativeTime(item.lastUsedAt)} />
      </View>
    </View>
  );
}

export default function RankingScreen() {
  const config = useSnapshot(adminConfigState);
  const hasAccount = hasAuthenticatedAdminSession(config);
  const [rangeKey, setRangeKey] = useState<RankingRangeKey>('today');
  const [rankingMode, setRankingMode] = useState<RankingMode>('group');
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [progress, setProgress] = useState({ loaded: 0, failed: 0, total: 0 });
  const [accountRows, setAccountRows] = useState<AccountRankingRow[]>([]);
  const [accountProgress, setAccountProgress] = useState({ loaded: 0, failed: 0, total: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const range = useMemo(() => getApiKeyUsageDateRange(rangeKey), [rangeKey]);

  const apiKeysQuery = useQuery({
    queryKey: ['ranking-api-keys'],
    queryFn: loadAllApiKeys,
    enabled: hasAccount,
    staleTime: 60_000,
  });

  const apiKeys = useMemo(() => apiKeysQuery.data ?? [], [apiKeysQuery.data]);
  const accountsQuery = useQuery({
    queryKey: ['ranking-accounts'],
    queryFn: () => listAllAccounts(),
    enabled: hasAccount && rankingMode === 'group',
    staleTime: 60_000,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  useEffect(() => {
    if (!hasAccount || rankingMode !== 'api-key' || apiKeys.length === 0) {
      setRows([]);
      setProgress({ loaded: 0, failed: 0, total: 0 });
      return;
    }

    let cancelled = false;
    setRows([]);
    setProgress({ loaded: 0, failed: 0, total: apiKeys.length });

    async function loadUsageBatches() {
      for (let start = 0; start < apiKeys.length; start += API_KEY_USAGE_BATCH_SIZE) {
        if (cancelled) return;

        const batch = apiKeys.slice(start, start + API_KEY_USAGE_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((item) => getApiKeyRankingRow(item, range)));

        if (cancelled) return;

        const fulfilled = results
          .filter((result): result is PromiseFulfilledResult<RankingRow> => result.status === 'fulfilled')
          .map((result) => result.value);
        const failed = results.length - fulfilled.length;

        setRows((current) => [...current, ...fulfilled]);
        setProgress((current) => ({
          total: apiKeys.length,
          loaded: current.loaded + results.length,
          failed: current.failed + failed,
        }));
      }
    }

    void loadUsageBatches();

    return () => {
      cancelled = true;
    };
  }, [apiKeys, hasAccount, range, rankingMode, refreshNonce]);

  useEffect(() => {
    if (!hasAccount || rankingMode !== 'group' || accounts.length === 0) {
      setAccountRows([]);
      setAccountProgress({ loaded: 0, failed: 0, total: 0 });
      return;
    }

    let cancelled = false;
    setAccountRows([]);
    setAccountProgress({ loaded: 0, failed: 0, total: accounts.length });

    async function loadAccountUsageBatches() {
      for (let start = 0; start < accounts.length; start += API_KEY_USAGE_BATCH_SIZE) {
        if (cancelled) return;

        const batch = accounts.slice(start, start + API_KEY_USAGE_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((account) => getAccountRankingRow(account, rangeKey, range)));

        if (cancelled) return;

        const fulfilled = results
          .filter((result): result is PromiseFulfilledResult<AccountRankingRow> => result.status === 'fulfilled')
          .map((result) => result.value);
        const failed = results.length - fulfilled.length;

        setAccountRows((current) => [...current, ...fulfilled]);
        setAccountProgress((current) => ({
          total: accounts.length,
          loaded: current.loaded + results.length,
          failed: current.failed + failed,
        }));
      }
    }

    void loadAccountUsageBatches();

    return () => {
      cancelled = true;
    };
  }, [accounts, hasAccount, range, rangeKey, rankingMode, refreshNonce]);

  const topRows = useMemo(() => getTopApiKeyUsageRows(rows, 20), [rows]);
  const topGroupRows = useMemo(() => buildGroupRows(apiKeys, accountRows, accounts), [accountRows, accounts, apiKeys]);
  const totals = useMemo(
    () => {
      const sourceRows: UsageMetricTotals[] = rankingMode === 'group' ? accountRows : rows;
      return sourceRows.reduce(
        (sum, item) => ({
          requests: sum.requests + item.requests,
          inputTokens: sum.inputTokens + item.inputTokens,
          cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
          outputTokens: sum.outputTokens + item.outputTokens,
          totalTokens: sum.totalTokens + item.totalTokens,
          cost: sum.cost + item.cost,
        }),
        { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      );
    },
    [accountRows, rankingMode, rows]
  );
  const isUsageLoading = progress.total > 0 && progress.loaded < progress.total;
  const isAccountUsageLoading = accountProgress.total > 0 && accountProgress.loaded < accountProgress.total;
  const isRefreshing = apiKeysQuery.isRefetching || accountsQuery.isRefetching || isUsageLoading || isAccountUsageLoading;
  const activeProgress = rankingMode === 'group' ? accountProgress : progress;
  const loadingText = activeProgress.total > 0
    ? `已统计 ${activeProgress.loaded}/${activeProgress.total} 个 ${rankingMode === 'group' ? 'AI账号' : 'API Key'}`
    : '正在准备排行榜数据...';

  function refreshAll() {
    setRows([]);
    setProgress({ loaded: 0, failed: 0, total: 0 });
    setAccountRows([]);
    setAccountProgress({ loaded: 0, failed: 0, total: 0 });
    setRefreshNonce((value) => value + 1);
    void apiKeysQuery.refetch();
    void accountsQuery.refetch();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>排行榜</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: '#8a8072' }}>按总成本排序的 Top 20。</Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            style={{ backgroundColor: colors.card, borderRadius: 14, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          >
            <Settings2 color={colors.text} size={20} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {([
            ['api-key', 'API-Key'],
            ['group', '分组'],
          ] as const).map(([key, label]) => {
            const active = rankingMode === key;
            return (
              <Pressable
                key={key}
                onPress={() => setRankingMode(key)}
                style={{
                  backgroundColor: active ? colors.primary : colors.card,
                  borderRadius: 999,
                  paddingHorizontal: 13,
                  paddingVertical: 9,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: active ? '#fff' : colors.text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {RANGE_OPTIONS.map((option) => {
            const active = option.key === rangeKey;
            return (
              <Pressable
                key={option.key}
                onPress={() => setRangeKey(option.key)}
                style={{
                  backgroundColor: active ? colors.primary : colors.card,
                  borderRadius: 999,
                  paddingHorizontal: 13,
                  paddingVertical: 9,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: active ? '#fff' : colors.text, fontSize: 12, fontWeight: '800' }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {!hasAccount ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>未连接服务器</Text>
            <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 22, color: colors.subtext }}>请先配置服务器地址和 Admin Token，再查看排行榜。</Text>
            <Pressable
              style={{ marginTop: 14, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}
              onPress={() => router.push('/settings')}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>去配置服务器</Text>
            </Pressable>
          </View>
        ) : null}

        {hasAccount ? (
          <>
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>当前时段</Text>
              <Text style={{ marginTop: 6, fontSize: 12, color: colors.subtext }}>
                {range.start_date} 到 {range.end_date} · {loadingText}
                {activeProgress.failed ? ` · 失败 ${activeProgress.failed}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <SummaryTile label="总成本" value={formatCost(totals.cost)} accent />
                <SummaryTile label="总请求" value={formatInteger(totals.requests)} />
                <SummaryTile label="总 Token" value={formatTokenValue(totals.totalTokens)} />
              </View>
            </View>

            {apiKeysQuery.isLoading ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
                <Text style={{ color: colors.subtext }}>正在加载 API Key 清单...</Text>
              </View>
            ) : null}

            {rankingMode === 'group' && accountsQuery.isLoading ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 12 }}>
                <Text style={{ color: colors.subtext }}>正在加载分组账号统计...</Text>
              </View>
            ) : null}

            {apiKeysQuery.error || (rankingMode === 'group' && accountsQuery.error) ? (
              <View style={{ backgroundColor: colors.dangerBg, borderRadius: 16, padding: 14 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.danger }}>排行榜数据加载失败</Text>
                <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.danger }}>
                  {getErrorMessage(apiKeysQuery.error ?? accountsQuery.error)}
                </Text>
              </View>
            ) : null}

            {!apiKeysQuery.isLoading && !apiKeysQuery.error && !(rankingMode === 'group' && accountsQuery.error) ? (
              rankingMode === 'api-key' ? (
                topRows.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {topRows.map((item, index) => (
                      <ApiKeyUsageRowCard
                        key={item.apiKeyId}
                        index={index + 1}
                        title={item.apiKeyName}
                        subtitleLines={[item.groupLabel, item.lastUsedText].filter(Boolean) as string[]}
                        totals={item}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
                    <Text style={{ color: colors.subtext }}>{isUsageLoading ? '正在计算排行榜...' : '当前时段没有 API Key 消费数据。'}</Text>
                  </View>
                )
              ) : topGroupRows.length > 0 ? (
                <View style={{ gap: 10 }}>
                  {topGroupRows.map((item, index) => (
                    <GroupRankingCard key={item.groupFilterKey} item={item} index={index + 1} />
                  ))}
                </View>
              ) : (
                <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
                  <Text style={{ color: colors.subtext }}>{isAccountUsageLoading ? '正在计算分组排行榜...' : '当前时段没有分组消费数据。'}</Text>
                </View>
              )
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
