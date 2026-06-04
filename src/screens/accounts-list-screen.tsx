import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { KeyRound, Search, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import {
  getAccountError,
  getAccountErrorMessage,
  getAccountVisualStatus,
  parseAccountStatusFilter,
  type AccountStatusFilter,
} from '@/src/lib/account-status';
import {
  formatRelativeTime,
  formatUsageWindowReset,
  getAccountUsageWindows,
  isUsageWindowLimited,
} from '@/src/lib/account-usage';
import { formatDisplayTime, formatTokenValue } from '@/src/lib/formatters';
import { getAccountTodayStats, listAccounts, setAccountSchedulable, testAccount } from '@/src/services/admin';
import type { AccountTestResult } from '@/src/lib/account-test';

type UsageSort = 'usage-desc' | 'usage-asc';
type GroupFilterKey = 'all' | `group:${number}` | 'ungrouped';

type AccountTodaySummary = {
  requests: number;
  tokens: number;
  cost: number;
};

type AccountsListScreenProps = {
  safeAreaEdges?: Edge[];
};

function AccountTestResultPanel({ result }: { result: AccountTestResult }) {
  return (
    <View className="rounded-[14px] bg-[#111827] px-3 py-3">
      <Text className="text-xs text-[#9ca3af]">测试模型：{result.selectedModelName || result.selectedModelId || result.model || '--'}</Text>
      <Text className="mt-1 text-xs font-semibold text-[#60a5fa]">使用模型：{result.model || '--'}</Text>
      <Text className="mt-1 text-xs text-[#9ca3af]">发送测试消息："{result.prompt}"</Text>
      <Text className={result.ok ? 'mt-2 text-xs font-semibold text-[#facc15]' : 'mt-2 text-xs font-semibold text-[#facc15]'}>
        响应：
      </Text>
      <Text className={result.ok ? 'mt-1 text-sm leading-5 text-[#d1fae5]' : 'mt-1 text-sm leading-5 text-[#fca5a5]'}>
        {result.ok ? result.responseText || '测试完成，未返回文本内容' : result.error || '测试失败'}
      </Text>
    </View>
  );
}

export function AccountsListScreen({ safeAreaEdges }: AccountsListScreenProps) {
  const { filter: routeFilter } = useLocalSearchParams<{ filter?: string | string[] }>();
  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<AccountStatusFilter>(() => parseAccountStatusFilter(routeFilter));
  const [usageSort, setUsageSort] = useState<UsageSort>('usage-desc');
  const [groupFilter, setGroupFilter] = useState<GroupFilterKey>('all');
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testFeedbackByAccountId, setTestFeedbackByAccountId] = useState<Record<number, AccountTestResult>>({});
  const [togglingAccountId, setTogglingAccountId] = useState<number | null>(null);
  const keyword = useDebouncedValue(searchText.trim(), 300);
  const queryClient = useQueryClient();

  useEffect(() => {
    setFilter(parseAccountStatusFilter(routeFilter));
  }, [routeFilter]);

  const accountsQuery = useQuery({
    queryKey: ['accounts', keyword],
    queryFn: () => listAccounts(keyword),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ accountId, schedulable }: { accountId: number; schedulable: boolean }) =>
      setAccountSchedulable(accountId, schedulable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const testMutation = useMutation({
    mutationFn: (account: (typeof items)[number]) => testAccount(account),
  });

  const items = accountsQuery.data?.items ?? [];
  const accountCostQueries = useQueries({
    queries: items.map((account) => ({
      queryKey: ['account-today-stats', account.id],
      queryFn: () => getAccountTodayStats(account.id),
      staleTime: 60_000,
    })),
  });

  const todayByAccountId = useMemo(() => {
    const next = new Map<number, AccountTodaySummary>();
    items.forEach((account, index) => {
      const result = accountCostQueries[index]?.data;
      const fromStatsCost = typeof result?.cost === 'number' && Number.isFinite(result.cost) ? result.cost : undefined;
      const fromExtra = typeof account.extra?.today_cost === 'number' ? account.extra.today_cost : undefined;
      const cost = fromStatsCost ?? fromExtra ?? 0;
      const requests = typeof result?.requests === 'number' && Number.isFinite(result.requests) ? result.requests : 0;
      const tokens = typeof result?.tokens === 'number' && Number.isFinite(result.tokens) ? result.tokens : 0;
      next.set(account.id, { requests, tokens, cost });
    });
    return next;
  }, [accountCostQueries, items]);

  const statusMatchedItems = useMemo(
    () =>
      items.filter((account) => {
        const visualStatus = getAccountVisualStatus(account);
        if (filter === 'all') return true;
        if (filter === 'active') return visualStatus.filterKey === 'active';
        if (filter === 'limited') return visualStatus.filterKey === 'limited';
        if (filter === 'paused') return visualStatus.filterKey === 'paused';
        if (filter === 'error') return visualStatus.filterKey === 'error';
        return true;
      }),
    [filter, items]
  );

  const groupOptions = useMemo(() => {
    const grouped = new Map<number, { key: GroupFilterKey; label: string; count: number; sortName: string }>();
    let ungroupedCount = 0;

    statusMatchedItems.forEach((account) => {
      const groups = account.groups?.filter((group) => group.id && group.name?.trim()) ?? [];

      if (groups.length === 0) {
        ungroupedCount += 1;
        return;
      }

      groups.forEach((group) => {
        const current = grouped.get(group.id) ?? {
          key: `group:${group.id}` as const,
          label: group.name.trim(),
          count: 0,
          sortName: group.name.trim().toLowerCase(),
        };
        current.count += 1;
        grouped.set(group.id, current);
      });
    });

    const options = [
      { key: 'all' as const, label: '全部分组', count: statusMatchedItems.length, sortName: '' },
      ...[...grouped.values()].sort((left, right) => left.sortName.localeCompare(right.sortName)),
    ];

    if (ungroupedCount > 0) {
      options.push({ key: 'ungrouped' as const, label: '未分组', count: ungroupedCount, sortName: 'zzzz' });
    }

    return options;
  }, [statusMatchedItems]);

  useEffect(() => {
    if (!groupOptions.some((option) => option.key === groupFilter)) {
      setGroupFilter('all');
    }
  }, [groupFilter, groupOptions]);

  const filteredItems = useMemo(() => {
    const groupMatched = statusMatchedItems.filter((account) => {
      if (groupFilter === 'all') return true;
      const groups = account.groups ?? [];
      if (groupFilter === 'ungrouped') return groups.length === 0;
      const groupId = Number(groupFilter.replace('group:', ''));
      return groups.some((group) => group.id === groupId);
    });

    const sorted = [...groupMatched].sort((left, right) => {
      const requestsLeft = todayByAccountId.get(left.id)?.requests ?? 0;
      const requestsRight = todayByAccountId.get(right.id)?.requests ?? 0;
      if (requestsLeft === requestsRight) {
        const tokensLeft = todayByAccountId.get(left.id)?.tokens ?? 0;
        const tokensRight = todayByAccountId.get(right.id)?.tokens ?? 0;
        return tokensLeft - tokensRight;
      }
      if (usageSort === 'usage-asc') return requestsLeft - requestsRight;
      return requestsRight - requestsLeft;
    });

    return sorted;
  }, [groupFilter, statusMatchedItems, todayByAccountId, usageSort]);
  const errorMessage = accountsQuery.error instanceof Error ? accountsQuery.error.message : '';

  const summary = useMemo(() => {
    const total = items.length;
    const errors = items.filter((item) => getAccountVisualStatus(item).filterKey === 'error').length;
    const limited = items.filter((item) => getAccountVisualStatus(item).filterKey === 'limited').length;
    const paused = items.filter((item) => getAccountVisualStatus(item).filterKey === 'paused').length;
    const active = items.filter((item) => getAccountVisualStatus(item).filterKey === 'active').length;
    return { total, active, limited, paused, errors };
  }, [items]);

  const listHeader = useMemo(
    () => (
      <View className="pb-2">
        <View className="rounded-[24px] bg-[#fbf8f2] p-2.5">
          <View className="flex-row items-center rounded-[18px] bg-[#f1ece2] px-4 py-3">
            <Search color="#7d7468" size={18} />
            <TextInput
              defaultValue=""
              onChangeText={setSearchText}
              placeholder="搜索账号名称 / 平台"
              placeholderTextColor="#9b9081"
              className="ml-3 flex-1 text-base text-[#16181a]"
            />
          </View>

          <View className="mt-3 flex-row gap-2">
            {([
              ['all', `全部 ${summary.total}`],
              ['active', `正常 ${summary.active}`],
              ['limited', `限流 ${summary.limited}`],
              ['paused', `暂停 ${summary.paused}`],
              ['error', `异常 ${summary.errors}`],
            ] as const).map(([key, label]) => {
              const active = filter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  className={active ? 'rounded-full bg-[#1d5f55] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-3 flex-row gap-2">
            {([
              ['usage-desc', '请求高→低'],
              ['usage-asc', '请求低→高'],
            ] as const).map(([key, label]) => {
              const active = usageSort === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setUsageSort(key)}
                  className={active ? 'rounded-full bg-[#4e463e] px-3 py-3' : 'rounded-full bg-[#e7dfcf] px-3 py-3'}
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {groupOptions.map((option) => {
              const active = groupFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setGroupFilter(option.key)}
                  className={active ? 'rounded-full bg-[#7651c8] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}
                >
                  <Text
                    numberOfLines={1}
                    className={active ? 'max-w-40 text-xs font-semibold text-white' : 'max-w-40 text-xs font-semibold text-[#4e463e]'}
                  >
                    {option.label}({option.count})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    ),
    [filter, groupFilter, groupOptions, summary.active, summary.errors, summary.limited, summary.paused, summary.total, usageSort]
  );

  const renderItem = useCallback(
    ({ item: account }: { item: (typeof filteredItems)[number] }) => {
      const isError = getAccountError(account);
      const visualStatus = getAccountVisualStatus(account);
      const statusText = visualStatus.label;
      const groupsText = account.groups?.map((group) => group.name).filter(Boolean).slice(0, 3).join(' · ') || '未分组';
      const currentConcurrency = account.current_concurrency ?? 0;
      const capacityText = `${currentConcurrency} / ${account.concurrency ?? 0}`;
      const createdAtText = formatDisplayTime(account.created_at);
      const isBusy = currentConcurrency > 0;
      const accountErrorMessage = getAccountErrorMessage(account);
      const todayStats = todayByAccountId.get(account.id) ?? { requests: 0, tokens: 0, cost: 0 };
      const usageWindows = getAccountUsageWindows(account);
      const recentUsedText = formatRelativeTime(account.last_used_at);
      const nextSchedulable = visualStatus.filterKey === 'paused';
      const toggleLabel = nextSchedulable ? '恢复' : '暂停';
      const testFeedback = testFeedbackByAccountId[account.id];
      const isTogglingCurrent = togglingAccountId === account.id && toggleMutation.isPending;
      const isTestingCurrent = testingAccountId === account.id && testMutation.isPending;

      return (
        <View>
          <ListCard
            title={account.name}
            meta={`${account.platform} · ${account.type}`}
            badge={statusText}
            badgeTone={visualStatus.badgeTone}
            icon={KeyRound}
          >
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  {account.schedulable && !isError ? <ShieldCheck color="#7d7468" size={14} /> : <ShieldOff color="#7d7468" size={14} />}
                  <Text className="text-sm text-[#7d7468]">状态：{statusText}</Text>
                </View>
              </View>

              <View className="flex-row gap-2">
                <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
                  <Text className="text-[11px] text-[#7d7468]">请求次数</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">{todayStats.requests}</Text>
                </View>
                <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
                  <Text className="text-[11px] text-[#7d7468]">消费金额</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">${todayStats.cost.toFixed(2)}</Text>
                </View>
                <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
                  <Text className="text-[11px] text-[#7d7468]">token消耗</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">{formatTokenValue(todayStats.tokens)}</Text>
                </View>
              </View>

              <View className="flex-row items-start gap-3 rounded-[14px] bg-[#f7f3eb] px-3 py-3">
                <View className="flex-1">
                  <Text className="text-[11px] font-semibold text-[#4e5664]">用量窗口</Text>
                  {usageWindows.length > 0 ? (
                    <View className="mt-2 gap-2">
                      {usageWindows.map((window) => {
                        const limited = isUsageWindowLimited(window);
                        return (
                          <View key={window.key} className="flex-row items-center gap-2">
                            <Text className="min-w-8 rounded-md bg-[#e4ecff] px-2 py-1 text-center text-xs font-semibold text-[#3c45f0]">
                              {window.label}
                            </Text>
                            <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e0e2e7]">
                              <View
                                className={limited ? 'h-full rounded-full bg-[#ef4444]' : 'h-full rounded-full bg-[#2fb96b]'}
                                style={{ width: `${window.percent}%` }}
                              />
                            </View>
                            <Text className={limited ? 'min-w-24 text-xs text-[#ef4444]' : 'min-w-24 text-xs text-[#6f7785]'}>
                              {window.percent}% {formatUsageWindowReset(window)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text className="mt-2 text-xs text-[#8f96a3]">暂无窗口数据</Text>
                  )}
                </View>
                <View style={{ minWidth: 82 }}>
                  <Text className="text-right text-[11px] font-semibold text-[#4e5664]">最近使用</Text>
                  <Text className="mt-3 text-right text-lg font-semibold text-[#6f7785]">{recentUsedText}</Text>
                </View>
              </View>

              <Text className="text-xs text-[#7d7468]">优先级 {account.priority ?? 0} · 倍率 {(account.rate_multiplier ?? 1).toFixed(2)}x</Text>
              <Text className="text-xs text-[#7d7468]" numberOfLines={1}>分组 {groupsText}</Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <View className={isBusy ? 'rounded-lg bg-[#fff0b8] px-2 py-1' : 'rounded-lg bg-[#f1ece2] px-2 py-1'}>
                  <Text className={isBusy ? 'text-xs font-semibold text-[#a66a00]' : 'text-xs text-[#7d7468]'}>容量 {capacityText}</Text>
                </View>
                <Text className="text-xs text-[#7d7468]" numberOfLines={1}>· 创建时间 {createdAtText}</Text>
              </View>
              {accountErrorMessage ? <Text className="text-xs text-[#a4512b]">异常信息：{accountErrorMessage}</Text> : null}

              <View className="flex-row gap-2">
                <Pressable
                  className="rounded-full bg-[#1b1d1f] px-4 py-2"
                  disabled={isTestingCurrent}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTestingAccountId(account.id);
                    testMutation.mutate(account, {
                      onSuccess: (result) => {
                        setTestFeedbackByAccountId((current) => ({ ...current, [account.id]: result }));
                      },
                      onError: (error) => {
                        const message = error instanceof Error && error.message ? error.message : '测试失败';
                        setTestFeedbackByAccountId((current) => ({
                          ...current,
                          [account.id]: { ok: false, prompt: 'hi', error: message },
                        }));
                      },
                      onSettled: () => {
                        setTestingAccountId((current) => (current === account.id ? null : current));
                      },
                    });
                  }}
                >
                  <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-[#f6f1e8]">{isTestingCurrent ? '测试中...' : '测试'}</Text>
                </Pressable>
                <Pressable
                  className="rounded-full bg-[#e7dfcf] px-4 py-2"
                  disabled={isTogglingCurrent}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTogglingAccountId(account.id);
                    toggleMutation.mutate({
                      accountId: account.id,
                      schedulable: nextSchedulable,
                    }, {
                      onSettled: () => {
                        setTogglingAccountId((current) => (current === account.id ? null : current));
                      },
                    });
                  }}
                >
                  <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-[#4e463e]">{isTogglingCurrent ? '处理中...' : toggleLabel}</Text>
                </Pressable>
              </View>

              {testFeedback ? <AccountTestResultPanel result={testFeedback} /> : null}
            </View>
          </ListCard>
        </View>
      );
    },
    [testFeedbackByAccountId, testMutation, testingAccountId, todayByAccountId, toggleMutation, togglingAccountId]
  );

  const emptyState = useMemo(
    () => <ListCard title="暂无账号" meta={errorMessage || '连上后这里会展示账号列表。'} icon={KeyRound} />,
    [errorMessage]
  );

  return (
    <ScreenShell
      title="账号清单"
      subtitle="查看名称、平台&类型、请求次数、消费金额、token消耗，并支持筛选与排序。"
      titleAside={(
        <Text className="text-[11px] text-[#7d7468]">更接近网页后台的账号视图。</Text>
      )}
      variant="minimal"
      scroll={false}
      safeAreaEdges={safeAreaEdges}
      bottomInsetClassName="pb-6"
      contentGapClassName="mt-2 gap-2"
    >
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 12, flexGrow: 1 }}
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.id}`}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={accountsQuery.isRefetching} onRefresh={() => void accountsQuery.refetch()} tintColor="#1d5f55" />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
        ItemSeparatorComponent={() => <View className="h-4" />}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </ScreenShell>
  );
}
