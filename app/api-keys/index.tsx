import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiKeyCard } from '@/src/components/api-key-card';
import {
  API_KEY_USAGE_BATCH_SIZE,
  buildApiKeyGroupFilterOptions,
  filterApiKeysByGroup,
  parseApiKeyGroupFilter,
  sortApiKeysByLastUsedDesc,
} from '@/src/lib/api-key-usage';
import {
  getApiKeyUsageSummary,
  getLatestApiKeyUsageLog,
  listAllApiKeys,
  listAllUserApiKeysFallback,
  type ApiKeyUsageSummary,
} from '@/src/services/admin';
import { getIpInfo } from '@/src/services/ipinfo';
import type { AdminApiKey } from '@/src/types/admin';

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  dangerBg: '#fbf1eb',
  danger: '#c25d35',
};

function formatDateParam(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayRange() {
  const today = formatDateParam(new Date());
  return {
    start_date: today,
    end_date: today,
  };
}

function getMonthRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);

  return {
    start_date: formatDateParam(start),
    end_date: formatDateParam(end),
  };
}

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

  return 'API Keys 加载失败，请检查服务地址、Token 和网络。';
}

async function loadAllApiKeys() {
  try {
    return await listAllApiKeys();
  } catch {
    return listAllUserApiKeysFallback();
  }
}

export default function ApiKeysIndexScreen() {
  const { group: routeGroup } = useLocalSearchParams<{ group?: string | string[] }>();
  const groupFilter = parseApiKeyGroupFilter(routeGroup);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [keyUsageById, setKeyUsageById] = useState<Record<number, ApiKeyUsageSummary>>({});
  const [loadingKeyUsageIds, setLoadingKeyUsageIds] = useState<Record<number, boolean>>({});
  const [expandedKeyDetailId, setExpandedKeyDetailId] = useState<number | null>(null);
  const loadedKeyUsageSignatureRef = useRef('');
  const todayRange = useMemo(() => getTodayRange(), []);
  const monthRange = useMemo(() => getMonthRange(), []);

  const apiKeysQuery = useQuery({
    queryKey: ['api-keys', 'all'],
    queryFn: loadAllApiKeys,
    staleTime: 60_000,
  });

  const apiKeys = apiKeysQuery.data ?? [];
  const sortedApiKeys = useMemo(() => sortApiKeysByLastUsedDesc(apiKeys), [apiKeys]);
  const groupOptions = useMemo(() => buildApiKeyGroupFilterOptions(sortedApiKeys), [sortedApiKeys]);
  const selectedGroupOption = groupOptions.find((option) => option.key === groupFilter);
  const filteredApiKeys = useMemo(() => filterApiKeysByGroup(sortedApiKeys, groupFilter), [groupFilter, sortedApiKeys]);
  const filteredApiKeyIds = useMemo(() => filteredApiKeys.map((item) => item.id), [filteredApiKeys]);

  const latestAccessQuery = useQuery({
    queryKey: ['api-key-latest-access', 'global', expandedKeyDetailId],
    queryFn: () => {
      const apiKey = filteredApiKeys.find((item) => item.id === expandedKeyDetailId);
      const userId = Number(apiKey?.user?.id ?? apiKey?.user_id);
      return getLatestApiKeyUsageLog({ userId, apiKeyId: expandedKeyDetailId as number });
    },
    enabled: typeof expandedKeyDetailId === 'number',
    staleTime: 30_000,
  });
  const latestAccessIp = latestAccessQuery.data?.ip_address?.trim();
  const latestAccessIpInfoQuery = useQuery({
    queryKey: ['ipinfo', latestAccessIp],
    queryFn: () => getIpInfo(latestAccessIp as string),
    enabled: Boolean(expandedKeyDetailId && latestAccessIp),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    const signature = [
      todayRange.start_date,
      todayRange.end_date,
      monthRange.start_date,
      monthRange.end_date,
      filteredApiKeyIds.join(','),
    ].join('|');

    if (filteredApiKeyIds.length === 0) {
      if (loadedKeyUsageSignatureRef.current !== signature) {
        setKeyUsageById({});
        setLoadingKeyUsageIds({});
        loadedKeyUsageSignatureRef.current = signature;
      }
      return;
    }

    if (loadedKeyUsageSignatureRef.current !== signature) {
      loadedKeyUsageSignatureRef.current = signature;
      setKeyUsageById({});
      setLoadingKeyUsageIds(Object.fromEntries(filteredApiKeyIds.map((apiKeyId) => [apiKeyId, true])));
    }

    let cancelled = false;

    async function loadApiKeyUsageQueue() {
      for (let start = 0; start < filteredApiKeyIds.length; start += API_KEY_USAGE_BATCH_SIZE) {
        if (cancelled) return;
        const batchIds = filteredApiKeyIds.slice(start, start + API_KEY_USAGE_BATCH_SIZE);

        setLoadingKeyUsageIds((current) => ({
          ...current,
          ...Object.fromEntries(batchIds.map((apiKeyId) => [apiKeyId, true])),
        }));

        const summaries = await Promise.all(
          batchIds.map((apiKeyId) => {
            const apiKey = filteredApiKeys.find((item) => item.id === apiKeyId);
            const userId = Number(apiKey?.user?.id ?? apiKey?.user_id);
            return getApiKeyUsageSummary({
              userId,
              apiKeyId,
              todayRange,
              monthRange,
            });
          })
        );

        if (cancelled) return;

        setKeyUsageById((current) => ({
          ...current,
          ...Object.fromEntries(summaries.map((summary) => [summary.apiKeyId, summary])),
        }));
        setLoadingKeyUsageIds((current) => ({
          ...current,
          ...Object.fromEntries(batchIds.map((apiKeyId) => [apiKeyId, false])),
        }));
      }
    }

    void loadApiKeyUsageQueue();

    return () => {
      cancelled = true;
    };
  }, [filteredApiKeyIds, filteredApiKeys, monthRange, todayRange]);

  async function copyKey(item: AdminApiKey) {
    await Clipboard.setStringAsync(item.key || '');
    setCopiedKeyId(item.id);
    setTimeout(() => {
      setCopiedKeyId((current) => (current === item.id ? null : current));
    }, 1500);
  }

  function toggleKeyDetails(apiKeyId: number) {
    setExpandedKeyDetailId((current) => (current === apiKeyId ? null : apiKeyId));
  }

  return (
    <>
      <Stack.Screen options={{ title: selectedGroupOption ? `${selectedGroupOption.label} API Keys` : 'API Keys' }} />
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.page }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 34 }}
          refreshControl={<RefreshControl refreshing={apiKeysQuery.isRefetching} onRefresh={() => void apiKeysQuery.refetch()} tintColor="#1d5f55" />}
        >
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>API Keys</Text>
            <Text style={{ marginTop: 6, fontSize: 12, color: colors.subtext }}>
              {selectedGroupOption ? `${selectedGroupOption.label}(${selectedGroupOption.count})` : `全部分组(${apiKeys.length})`}
            </Text>
          </View>

          {apiKeysQuery.isLoading ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 14 }}>
              <Text style={{ color: colors.subtext }}>正在加载 API Keys...</Text>
            </View>
          ) : null}

          {apiKeysQuery.error ? (
            <View style={{ backgroundColor: colors.dangerBg, borderRadius: 16, padding: 14 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.danger }}>API Keys 加载失败</Text>
              <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.danger }}>{getErrorMessage(apiKeysQuery.error)}</Text>
            </View>
          ) : null}

          {!apiKeysQuery.isLoading && !apiKeysQuery.error ? (
            filteredApiKeys.length > 0 ? (
              <View>
                {filteredApiKeys.map((item) => {
                  const usage = keyUsageById[item.id];
                  const userId = Number(item.user?.id ?? item.user_id);

                  return (
                    <ApiKeyCard
                      key={item.id}
                      item={item}
                      copied={copiedKeyId === item.id}
                      onCopy={() => copyKey(item)}
                      todayUsage={usage?.today}
                      monthUsage={usage?.month}
                      usageLoading={loadingKeyUsageIds[item.id] ?? !usage}
                      usageError={Boolean(usage?.todayError || usage?.monthError)}
                      detailsExpanded={expandedKeyDetailId === item.id}
                      onToggleDetails={() => toggleKeyDetails(item.id)}
                      latestAccessLog={expandedKeyDetailId === item.id ? latestAccessQuery.data : undefined}
                      latestAccessIpInfo={expandedKeyDetailId === item.id ? latestAccessIpInfoQuery.data : undefined}
                      latestAccessLoading={expandedKeyDetailId === item.id && latestAccessQuery.isLoading}
                      latestAccessError={expandedKeyDetailId === item.id && Boolean(latestAccessQuery.error)}
                      latestAccessIpInfoLoading={expandedKeyDetailId === item.id && Boolean(latestAccessIp) && latestAccessIpInfoQuery.isLoading}
                      latestAccessIpInfoError={expandedKeyDetailId === item.id && Boolean(latestAccessIpInfoQuery.error)}
                      onPressMonthUsage={() =>
                        router.push({
                          pathname: '/users/[id]/api-keys/[keyId]',
                          params: {
                            id: String(userId),
                            keyId: String(item.id),
                            keyName: item.name || `Key #${item.id}`,
                            userEmail: item.user?.email || '',
                          },
                        })
                      }
                    />
                  );
                })}
              </View>
            ) : (
              <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 14 }}>
                <Text style={{ color: colors.subtext }}>当前分组下没有 API Key。</Text>
              </View>
            )
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
