import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiKeyUsageRowCard } from '@/src/components/usage/api-key-usage-row-card';
import {
  aggregateTrendPoints,
  buildDailyUsageRows,
  getApiKeyUsageDateRange,
} from '@/src/lib/api-key-usage';
import { formatCost, formatInteger, formatTokenValue } from '@/src/lib/formatters';
import { getDashboardSnapshot } from '@/src/services/admin';

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
};

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

  return '当前无法加载 API Key 用量明细，请检查服务地址、Token 和网络。';
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        backgroundColor: colors.muted,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 16, fontWeight: '800', color: accent ? '#8c5a22' : colors.text }}>
        {value}
      </Text>
    </View>
  );
}

export default function ApiKeyUsageDetailScreen() {
  const { id, keyId, keyName, userEmail } = useLocalSearchParams<{
    id: string;
    keyId: string;
    keyName?: string;
    userEmail?: string;
  }>();
  const userId = Number(id);
  const apiKeyId = Number(keyId);
  const range = useMemo(() => getApiKeyUsageDateRange('30d'), []);
  const displayName = typeof keyName === 'string' && keyName.trim() ? keyName.trim() : `Key #${apiKeyId}`;
  const displayUser = typeof userEmail === 'string' && userEmail.trim() ? userEmail.trim() : undefined;

  const usageQuery = useQuery({
    queryKey: ['api-key-usage-detail', userId, apiKeyId, range.start_date, range.end_date],
    queryFn: () =>
      getDashboardSnapshot({
        ...range,
        user_id: userId,
        api_key_id: apiKeyId,
        include_stats: false,
        include_trend: true,
        include_model_stats: false,
        include_group_stats: false,
        include_users_trend: false,
      }),
    enabled: Number.isFinite(userId) && Number.isFinite(apiKeyId),
  });

  const trend = usageQuery.data?.trend ?? [];
  const totals = useMemo(() => aggregateTrendPoints(trend), [trend]);
  const rows = useMemo(() => buildDailyUsageRows(trend, range.start_date, range.end_date).reverse(), [range.end_date, range.start_date, trend]);
  const isRefreshing = usageQuery.isRefetching;

  return (
    <>
      <Stack.Screen options={{ title: '30天花费明细' }} />
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.page }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void usageQuery.refetch()} tintColor={colors.primary} />}
        >
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>{displayName}</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: colors.subtext }}>
              {range.start_date} 到 {range.end_date}{displayUser ? ` · ${displayUser}` : ''}
            </Text>
          </View>

          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>近30天汇总</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <SummaryTile label="总成本" value={formatCost(totals.cost)} accent />
              <SummaryTile label="总请求" value={formatInteger(totals.requests)} />
              <SummaryTile label="总 Token" value={formatTokenValue(totals.totalTokens)} />
            </View>
          </View>

          {usageQuery.isLoading ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
              <Text style={{ color: colors.subtext }}>正在加载 30 天消费明细...</Text>
            </View>
          ) : null}

          {usageQuery.error ? (
            <View style={{ backgroundColor: colors.dangerBg, borderRadius: 16, padding: 14 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.danger }}>明细加载失败</Text>
              <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.danger }}>{getErrorMessage(usageQuery.error)}</Text>
            </View>
          ) : null}

          {!usageQuery.isLoading && !usageQuery.error ? (
            <View style={{ gap: 10 }}>
              {rows.map((row) => (
                <ApiKeyUsageRowCard key={row.date} title={row.date} totals={row} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
