import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Settings2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiKeyUsageRowCard } from '@/src/components/usage/api-key-usage-row-card';
import {
  API_KEY_USAGE_BATCH_SIZE,
  aggregateTrendPoints,
  getApiKeyUsageDateRange,
  getTopApiKeyUsageRows,
  type ApiKeyUsageRange,
  type ApiKeyUsageRangeKey,
  type UsageMetricTotals,
} from '@/src/lib/api-key-usage';
import { formatCost, formatDisplayTime, formatInteger, formatTokenValue } from '@/src/lib/formatters';
import { getDashboardSnapshot, listAllApiKeys, listAllUserApiKeysFallback } from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import type { AdminApiKey } from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

type RankingRangeKey = ApiKeyUsageRangeKey;

type RankingRow = UsageMetricTotals & {
  apiKeyId: number;
  apiKeyName: string;
  userId: number;
  groupLabel?: string;
  lastUsedText?: string;
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
    groupLabel: item.group?.name,
    lastUsedText: item.last_used_at ? formatDisplayTime(item.last_used_at) : undefined,
  };
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

export default function RankingScreen() {
  const config = useSnapshot(adminConfigState);
  const hasAccount = hasAuthenticatedAdminSession(config);
  const [rangeKey, setRangeKey] = useState<RankingRangeKey>('today');
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [progress, setProgress] = useState({ loaded: 0, failed: 0, total: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const range = useMemo(() => getApiKeyUsageDateRange(rangeKey), [rangeKey]);

  const apiKeysQuery = useQuery({
    queryKey: ['ranking-api-keys'],
    queryFn: loadAllApiKeys,
    enabled: hasAccount,
    staleTime: 60_000,
  });

  const apiKeys = useMemo(() => apiKeysQuery.data ?? [], [apiKeysQuery.data]);

  useEffect(() => {
    if (!hasAccount || apiKeys.length === 0) {
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
  }, [apiKeys, hasAccount, range, refreshNonce]);

  const topRows = useMemo(() => getTopApiKeyUsageRows(rows, 20), [rows]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, item) => ({
          requests: sum.requests + item.requests,
          inputTokens: sum.inputTokens + item.inputTokens,
          cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
          outputTokens: sum.outputTokens + item.outputTokens,
          totalTokens: sum.totalTokens + item.totalTokens,
          cost: sum.cost + item.cost,
        }),
        { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      ),
    [rows]
  );
  const isUsageLoading = progress.total > 0 && progress.loaded < progress.total;
  const isRefreshing = apiKeysQuery.isRefetching || isUsageLoading;
  const loadingText = progress.total > 0 ? `已统计 ${progress.loaded}/${progress.total} 个 API Key` : '正在准备排行榜数据...';

  function refreshAll() {
    setRows([]);
    setProgress({ loaded: 0, failed: 0, total: 0 });
    setRefreshNonce((value) => value + 1);
    void apiKeysQuery.refetch();
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
            <Text style={{ marginTop: 6, fontSize: 13, color: '#8a8072' }}>按 API Key 总成本排序的 Top 20。</Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            style={{ backgroundColor: colors.card, borderRadius: 14, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          >
            <Settings2 color={colors.text} size={20} />
          </Pressable>
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
                {progress.failed ? ` · 失败 ${progress.failed}` : ''}
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

            {apiKeysQuery.error ? (
              <View style={{ backgroundColor: colors.dangerBg, borderRadius: 16, padding: 14 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.danger }}>API Key 清单加载失败</Text>
                <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.danger }}>{getErrorMessage(apiKeysQuery.error)}</Text>
              </View>
            ) : null}

            {!apiKeysQuery.isLoading && !apiKeysQuery.error ? (
              topRows.length > 0 ? (
                <View style={{ gap: 10 }}>
                  {topRows.map((item, index) => (
                    <ApiKeyUsageRowCard
                      key={item.apiKeyId}
                      index={index + 1}
                      title={item.apiKeyName}
                      subtitle={[item.groupLabel, item.lastUsedText].filter(Boolean).join(' · ')}
                      totals={item}
                    />
                  ))}
                </View>
              ) : (
                <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
                  <Text style={{ color: colors.subtext }}>{isUsageLoading ? '正在计算排行榜...' : '当前时段没有 API Key 消费数据。'}</Text>
                </View>
              )
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
