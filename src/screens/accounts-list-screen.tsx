import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { ExternalLink, KeyRound, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { AccountInfoCard } from '@/src/components/account-info-card';
import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import {
  buildOpenAIOAuthCredentials,
  buildOpenAIOAuthExtra,
  extractOAuthCode,
  extractOAuthState,
  parseOAuthState,
} from '@/src/lib/account-oauth';
import {
  getAccountVisualStatus,
  parseAccountStatusFilter,
  type AccountStatusFilter,
} from '@/src/lib/account-status';
import {
  getAccountUsageWindowsFromUsageInfo,
  type AccountUsageWindow,
} from '@/src/lib/account-usage';
import {
  applyOAuthCredentials,
  exchangeOpenAIAuthCode,
  generateOpenAIAuthUrl,
  getAccountTodayStats,
  getAccountUsage,
  listAccounts,
  setAccountSchedulable,
  testAccount,
} from '@/src/services/admin';
import type { AccountTestResult } from '@/src/lib/account-test';
import type { AdminAccount } from '@/src/types/admin';

type UsageSort = 'usage-desc' | 'usage-asc';
type GroupFilterKey = 'all' | `group:${number}` | 'ungrouped';

type AccountTodaySummary = {
  requests: number;
  tokens: number;
  cost: number;
};

type ReauthStep = 'idle' | 'generating' | 'ready' | 'submitting' | 'success';

type AccountsListScreenProps = {
  safeAreaEdges?: Edge[];
};

function isOpenAIOAuthAccount(account: Pick<AdminAccount, 'platform' | 'type'>) {
  return account.platform === 'openai' && account.type === 'oauth';
}

function parseAccountGroupFilter(value: unknown): GroupFilterKey {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (rawValue === 'all' || rawValue === 'ungrouped') {
    return rawValue;
  }

  if (typeof rawValue === 'string' && /^group:\d+$/.test(rawValue)) {
    return rawValue as `group:${number}`;
  }

  return 'all';
}

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
  const { filter: routeFilter, group: routeGroup } = useLocalSearchParams<{ filter?: string | string[]; group?: string | string[] }>();
  const routeGroupFilter = useMemo(() => parseAccountGroupFilter(routeGroup), [routeGroup]);
  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<AccountStatusFilter>(() => parseAccountStatusFilter(routeFilter));
  const [usageSort, setUsageSort] = useState<UsageSort>('usage-desc');
  const [groupFilter, setGroupFilter] = useState<GroupFilterKey>(() => routeGroupFilter);
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testFeedbackByAccountId, setTestFeedbackByAccountId] = useState<Record<number, AccountTestResult>>({});
  const [togglingAccountId, setTogglingAccountId] = useState<number | null>(null);
  const [queryingUsageAccountId, setQueryingUsageAccountId] = useState<number | null>(null);
  const [usageWindowsByAccountId, setUsageWindowsByAccountId] = useState<Record<number, AccountUsageWindow[]>>({});
  const [usageQueryErrorByAccountId, setUsageQueryErrorByAccountId] = useState<Record<number, string>>({});
  const [reauthAccount, setReauthAccount] = useState<AdminAccount | null>(null);
  const [reauthAuthUrl, setReauthAuthUrl] = useState('');
  const [reauthSessionId, setReauthSessionId] = useState('');
  const [reauthState, setReauthState] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [reauthStep, setReauthStep] = useState<ReauthStep>('idle');
  const [reauthError, setReauthError] = useState('');
  const [reauthFeedback, setReauthFeedback] = useState('');
  const keyword = useDebouncedValue(searchText.trim(), 300);
  const queryClient = useQueryClient();
  const usageQuerySpin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (queryingUsageAccountId === null) {
      usageQuerySpin.stopAnimation();
      usageQuerySpin.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(usageQuerySpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [queryingUsageAccountId, usageQuerySpin]);

  const usageQuerySpinStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: usageQuerySpin.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '360deg'],
          }),
        },
      ],
    }),
    [usageQuerySpin]
  );

  useEffect(() => {
    setFilter(parseAccountStatusFilter(routeFilter));
  }, [routeFilter]);

  useEffect(() => {
    setGroupFilter(routeGroupFilter);
  }, [routeGroupFilter]);

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

  const usageQueryMutation = useMutation({
    mutationFn: (accountId: number) => getAccountUsage(accountId, 'active', true),
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
    if (accountsQuery.isLoading || accountsQuery.isFetching) {
      return;
    }
    if (!groupOptions.some((option) => option.key === groupFilter)) {
      setGroupFilter('all');
    }
  }, [accountsQuery.isFetching, accountsQuery.isLoading, groupFilter, groupOptions]);

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
  const isReauthBusy = reauthStep === 'generating' || reauthStep === 'submitting';

  const closeReauthModal = useCallback(() => {
    if (reauthStep === 'submitting') {
      return;
    }

    setReauthAccount(null);
    setReauthAuthUrl('');
    setReauthSessionId('');
    setReauthState('');
    setReauthCode('');
    setReauthStep('idle');
    setReauthError('');
    setReauthFeedback('');
  }, [reauthStep]);

  const openReauthModal = useCallback(async (account: AdminAccount) => {
    setReauthAccount(account);
    setReauthAuthUrl('');
    setReauthSessionId('');
    setReauthState('');
    setReauthCode('');
    setReauthError('');
    setReauthFeedback('');
    setReauthStep('generating');

    try {
      const result = await generateOpenAIAuthUrl({ proxy_id: account.proxy_id });
      const state = parseOAuthState(result.auth_url);
      setReauthAuthUrl(result.auth_url);
      setReauthSessionId(result.session_id);
      setReauthState(state);
      setReauthStep('ready');

      if (!state) {
        setReauthError('授权链接中没有解析到 state。提交时请粘贴完整回调链接，或重新生成授权链接。');
      }
    } catch (error) {
      setReauthStep('ready');
      setReauthError(error instanceof Error && error.message ? error.message : '生成授权链接失败');
    }
  }, []);

  const openAuthUrl = useCallback(async () => {
    if (!reauthAuthUrl) {
      return;
    }

    try {
      await Linking.openURL(reauthAuthUrl);
    } catch (error) {
      setReauthError(error instanceof Error && error.message ? error.message : '打开授权链接失败');
    }
  }, [reauthAuthUrl]);

  const copyAuthUrl = useCallback(async () => {
    if (!reauthAuthUrl) {
      return;
    }

    try {
      await Clipboard.setStringAsync(reauthAuthUrl);
      setReauthFeedback('授权链接已复制');
    } catch (error) {
      setReauthError(error instanceof Error && error.message ? error.message : '复制授权链接失败');
    }
  }, [reauthAuthUrl]);

  const submitReauthCode = useCallback(async () => {
    if (!reauthAccount) {
      return;
    }

    const code = extractOAuthCode(reauthCode);
    const state = extractOAuthState(reauthCode) || reauthState;

    if (!reauthSessionId) {
      setReauthError('缺少 session_id，请重新生成授权链接。');
      return;
    }
    if (!code) {
      setReauthError('请粘贴授权后的 code 或完整回调链接。');
      return;
    }
    if (!state.trim()) {
      setReauthError('缺少 state，请粘贴完整回调链接或重新生成授权链接。');
      return;
    }

    setReauthStep('submitting');
    setReauthError('');
    setReauthFeedback('');

    try {
      const tokenInfo = await exchangeOpenAIAuthCode({
        session_id: reauthSessionId,
        code,
        state: state.trim(),
        proxy_id: reauthAccount.proxy_id,
      });

      await applyOAuthCredentials(reauthAccount.id, {
        type: 'oauth',
        credentials: buildOpenAIOAuthCredentials(tokenInfo),
        extra: buildOpenAIOAuthExtra(tokenInfo),
      });

      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setReauthStep('success');
      setReauthFeedback('重新授权成功，账号列表已刷新。');
    } catch (error) {
      setReauthStep('ready');
      setReauthError(error instanceof Error && error.message ? error.message : '重新授权失败');
    }
  }, [queryClient, reauthAccount, reauthCode, reauthSessionId, reauthState]);

  const handleQueryUsage = useCallback((accountId: number) => {
    setQueryingUsageAccountId(accountId);
    setUsageQueryErrorByAccountId((current) => {
      const next = { ...current };
      delete next[accountId];
      return next;
    });

    usageQueryMutation.mutate(accountId, {
      onSuccess: (usage) => {
        const windows = getAccountUsageWindowsFromUsageInfo(usage);
        setUsageWindowsByAccountId((current) => ({ ...current, [accountId]: windows }));
        void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      },
      onError: (error) => {
        const message = error instanceof Error && error.message ? error.message : '用量查询失败';
        setUsageQueryErrorByAccountId((current) => ({ ...current, [accountId]: message }));
      },
      onSettled: () => {
        setQueryingUsageAccountId((current) => (current === accountId ? null : current));
      },
    });
  }, [queryClient, usageQueryMutation]);

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
      const visualStatus = getAccountVisualStatus(account);
      const todayStats = todayByAccountId.get(account.id) ?? { requests: 0, tokens: 0, cost: 0 };
      const usageWindows = usageWindowsByAccountId[account.id];
      const usageQueryError = usageQueryErrorByAccountId[account.id];
      const nextSchedulable = visualStatus.filterKey === 'paused';
      const toggleLabel = nextSchedulable ? '恢复' : '暂停';
      const testFeedback = testFeedbackByAccountId[account.id];
      const isTogglingCurrent = togglingAccountId === account.id && toggleMutation.isPending;
      const isTestingCurrent = testingAccountId === account.id && testMutation.isPending;
      const canReauth = isOpenAIOAuthAccount(account);
      const isReauthCurrent = reauthAccount?.id === account.id && isReauthBusy;
      const isQueryingUsageCurrent = queryingUsageAccountId === account.id && usageQueryMutation.isPending;

      return (
        <AccountInfoCard
          account={account}
          todayStats={todayStats}
          usageWindows={usageWindows}
          usageQueryError={usageQueryError}
          isQueryingUsage={isQueryingUsageCurrent}
          usageQuerySpinStyle={usageQuerySpinStyle}
          onQueryUsage={handleQueryUsage}
        >
          <View className="flex-row flex-wrap gap-2">
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
            {canReauth ? (
              <Pressable
                className="rounded-full bg-[#dbeafe] px-4 py-2"
                disabled={isReauthCurrent}
                onPress={(event) => {
                  event.stopPropagation();
                  void openReauthModal(account);
                }}
              >
                <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-[#1d4ed8]">
                  {isReauthCurrent ? '生成中...' : '重新授权'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {testFeedback ? <AccountTestResultPanel result={testFeedback} /> : null}
        </AccountInfoCard>
      );
    },
    [
      isReauthBusy,
      handleQueryUsage,
      openReauthModal,
      queryingUsageAccountId,
      reauthAccount?.id,
      testFeedbackByAccountId,
      testMutation,
      testingAccountId,
      todayByAccountId,
      toggleMutation,
      togglingAccountId,
      usageQueryErrorByAccountId,
      usageQueryMutation.isPending,
      usageQuerySpinStyle,
      usageWindowsByAccountId,
    ]
  );

  const emptyState = useMemo(
    () => <ListCard title="暂无账号" meta={errorMessage || '连上后这里会展示账号列表。'} icon={KeyRound} />,
    [errorMessage]
  );
  const pastedReauthState = extractOAuthState(reauthCode);

  return (
    <>
      <Modal
        animationType="slide"
        transparent
        visible={Boolean(reauthAccount)}
        onRequestClose={closeReauthModal}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={12}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.42)' }}
        >
          <View className="max-h-[92%] rounded-t-[28px] bg-[#fbf8f2]">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20, paddingTop: 20 }}
            >
              <View className="flex-row items-start justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-lg font-bold text-[#16181a]">重新授权 OpenAI</Text>
                  <Text className="mt-1 text-xs text-[#7d7468]" numberOfLines={1}>
                    {reauthAccount?.name ?? '--'}
                  </Text>
                </View>
                <Pressable
                  className="rounded-full bg-[#e7dfcf] px-4 py-2"
                  disabled={reauthStep === 'submitting'}
                  onPress={closeReauthModal}
                >
                  <Text className="text-xs font-semibold text-[#4e463e]">关闭</Text>
                </Pressable>
              </View>

              <View className="mt-5 gap-4">
                <View className="rounded-[18px] bg-[#f1ece2] px-4 py-4">
                  <Text className="text-[11px] font-semibold text-[#7d7468]">OAuth URL</Text>
                  <Text className="mt-2 text-sm leading-5 text-[#16181a]" numberOfLines={3}>
                    {reauthStep === 'generating' ? '正在生成授权链接...' : reauthAuthUrl || '授权链接生成失败，请重试。'}
                  </Text>
                  <Text className="mt-2 text-[11px] text-[#7d7468]">
                    {reauthSessionId ? `Session ${reauthSessionId.slice(0, 10)}...` : '生成后会自动保存 session。'}
                  </Text>
                </View>

                <View className="flex-row gap-2">
                  <Pressable
                    className={reauthAuthUrl && !isReauthBusy ? 'flex-1 rounded-full bg-[#1d5f55] px-4 py-3' : 'flex-1 rounded-full bg-[#c9c2b4] px-4 py-3'}
                    disabled={!reauthAuthUrl || isReauthBusy}
                    onPress={() => void openAuthUrl()}
                  >
                    <View className="flex-row items-center justify-center gap-2">
                      <ExternalLink color="#f6f1e8" size={14} />
                      <Text className="text-center text-xs font-semibold text-[#f6f1e8]">打开授权链接</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    className={reauthAuthUrl && !isReauthBusy ? 'flex-1 rounded-full bg-[#e7dfcf] px-4 py-3' : 'flex-1 rounded-full bg-[#d8d0c1] px-4 py-3'}
                    disabled={!reauthAuthUrl || isReauthBusy}
                    onPress={() => void copyAuthUrl()}
                  >
                    <Text className="text-center text-xs font-semibold text-[#4e463e]">复制链接</Text>
                  </Pressable>
                </View>

                <View>
                  <Text className="mb-2 text-[11px] font-semibold text-[#7d7468]">授权后的 code 或完整回调链接</Text>
                  <TextInput
                    value={reauthCode}
                    onChangeText={setReauthCode}
                    placeholder="粘贴 code 或包含 code/state 的完整链接"
                    placeholderTextColor="#9b9081"
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    editable={reauthStep !== 'submitting' && reauthStep !== 'success'}
                    className="min-h-24 rounded-[18px] bg-white px-4 py-3 text-sm leading-5 text-[#16181a]"
                    textAlignVertical="top"
                  />
                  <Text className="mt-2 text-[11px] text-[#7d7468]">
                    {pastedReauthState
                      ? '将从粘贴的回调链接中读取 code/state。'
                      : reauthState
                        ? 'state 已准备好，请粘贴授权后的 code。'
                        : '如果没有生成 state，请粘贴完整回调链接。'}
                  </Text>
                </View>

                {reauthError ? <Text className="rounded-[14px] bg-[#fff0e8] px-3 py-2 text-xs leading-5 text-[#a4512b]">{reauthError}</Text> : null}
                {reauthFeedback ? <Text className="rounded-[14px] bg-[#e7f7ee] px-3 py-2 text-xs text-[#1d6b43]">{reauthFeedback}</Text> : null}

                <View className="flex-row gap-2">
                  <Pressable
                    className={reauthStep === 'submitting' || reauthStep === 'success' || !reauthAccount ? 'flex-1 rounded-full bg-[#c9c2b4] px-4 py-3' : 'flex-1 rounded-full bg-[#1b1d1f] px-4 py-3'}
                    disabled={reauthStep === 'submitting' || reauthStep === 'success' || !reauthAccount}
                    onPress={() => void submitReauthCode()}
                  >
                    <Text className="text-center text-sm font-semibold text-[#f6f1e8]">
                      {reauthStep === 'submitting' ? '正在提交...' : reauthStep === 'success' ? '已完成' : '完成授权'}
                    </Text>
                  </Pressable>
                  <Pressable
                    className={isReauthBusy || !reauthAccount ? 'rounded-full bg-[#d8d0c1] px-4 py-3' : 'rounded-full bg-[#e7dfcf] px-4 py-3'}
                    disabled={isReauthBusy || !reauthAccount}
                    onPress={() => {
                      if (reauthAccount) {
                        void openReauthModal(reauthAccount);
                      }
                    }}
                  >
                    <Text className="text-sm font-semibold text-[#4e463e]">重新生成</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
    </>
  );
}
