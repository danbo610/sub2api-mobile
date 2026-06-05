import { KeyRound, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react-native';
import type { ComponentProps, ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { getAccountError, getAccountErrorMessage, getAccountVisualStatus } from '@/src/lib/account-status';
import {
  formatRelativeTime,
  formatUsageWindowReset,
  getAccountUsageWindows,
  getUsageWindowTone,
  type AccountUsageWindow,
} from '@/src/lib/account-usage';
import { formatDisplayTime, formatTokenValue } from '@/src/lib/formatters';
import type { AdminAccount } from '@/src/types/admin';

export type AccountInfoStats = {
  requests: number;
  tokens: number;
  cost: number;
};

type AccountInfoCardProps = {
  account: AdminAccount;
  todayStats?: AccountInfoStats;
  usageWindows?: AccountUsageWindow[];
  usageQueryError?: string;
  isQueryingUsage?: boolean;
  usageQuerySpinStyle?: ComponentProps<typeof Animated.View>['style'];
  onQueryUsage?: (accountId: number) => void;
  children?: ReactNode;
  containerClassName?: string;
};

function getUsageProgressClassName(window: AccountUsageWindow) {
  const tone = getUsageWindowTone(window);
  if (tone === 'limited') return 'h-full rounded-full bg-[#ef4444]';
  if (tone === 'warning') return 'h-full rounded-full bg-[#f59e0b]';
  return 'h-full rounded-full bg-[#2fb96b]';
}

function getUsageTextClassName(window: AccountUsageWindow) {
  const tone = getUsageWindowTone(window);
  if (tone === 'limited') return 'min-w-24 text-xs text-[#ef4444]';
  if (tone === 'warning') return 'min-w-24 text-xs text-[#d97706]';
  return 'min-w-24 text-xs text-[#6f7785]';
}

export function AccountInfoCard({
  account,
  todayStats,
  usageWindows: usageWindowsOverride,
  usageQueryError,
  isQueryingUsage = false,
  usageQuerySpinStyle,
  onQueryUsage,
  children,
  containerClassName,
}: AccountInfoCardProps) {
  const isError = getAccountError(account);
  const visualStatus = getAccountVisualStatus(account);
  const groupsText = account.groups?.map((group) => group.name).filter(Boolean).slice(0, 3).join(' · ') || '未分组';
  const currentConcurrency = account.current_concurrency ?? 0;
  const capacityText = `${currentConcurrency} / ${account.concurrency ?? 0}`;
  const createdAtText = formatDisplayTime(account.created_at);
  const isBusy = currentConcurrency > 0;
  const accountErrorMessage = getAccountErrorMessage(account);
  const usageWindows = usageWindowsOverride ?? getAccountUsageWindows(account);
  const recentUsedText = formatRelativeTime(account.last_used_at);
  const stats = todayStats ?? { requests: 0, tokens: 0, cost: 0 };

  return (
    <View className={containerClassName}>
      <ListCard
        title={account.name}
        meta={`${account.platform} · ${account.type}`}
        badge={visualStatus.label}
        badgeTone={visualStatus.badgeTone}
        icon={KeyRound}
      >
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              {account.schedulable && !isError ? <ShieldCheck color="#7d7468" size={14} /> : <ShieldOff color="#7d7468" size={14} />}
              <Text className="text-sm text-[#7d7468]">状态：{visualStatus.label}</Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
              <Text className="text-[11px] text-[#7d7468]">请求次数</Text>
              <Text className="mt-1 text-sm font-bold text-[#16181a]">{stats.requests}</Text>
            </View>
            <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
              <Text className="text-[11px] text-[#7d7468]">消费金额</Text>
              <Text className="mt-1 text-sm font-bold text-[#16181a]">${stats.cost.toFixed(2)}</Text>
            </View>
            <View className="flex-1 rounded-[14px] bg-[#f1ece2] px-3 py-3">
              <Text className="text-[11px] text-[#7d7468]">token消耗</Text>
              <Text className="mt-1 text-sm font-bold text-[#16181a]">{formatTokenValue(stats.tokens)}</Text>
            </View>
          </View>

          <View className="flex-row items-start gap-3 rounded-[14px] bg-[#f7f3eb] px-3 py-3">
            <View className="flex-1">
              <Text className="text-[11px] font-semibold text-[#4e5664]">用量窗口</Text>
              {usageWindows.length > 0 ? (
                <View className="mt-2 gap-2">
                  {usageWindows.map((window) => (
                    <View key={window.key} className="flex-row items-center gap-2">
                      <Text className="min-w-8 rounded-md bg-[#e4ecff] px-2 py-1 text-center text-xs font-semibold text-[#3c45f0]">
                        {window.label}
                      </Text>
                      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e0e2e7]">
                        <View
                          className={getUsageProgressClassName(window)}
                          style={{ width: `${window.percent}%` }}
                        />
                      </View>
                      <Text className={getUsageTextClassName(window)}>
                        {window.percent}% {formatUsageWindowReset(window)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="mt-2 text-xs text-[#8f96a3]">暂无窗口数据</Text>
              )}
            </View>
            <View style={{ minWidth: 82 }}>
              <Text className="text-right text-[11px] font-semibold text-[#4e5664]">最近使用</Text>
              <Text className="mt-3 text-right text-lg font-semibold text-[#6f7785]">{recentUsedText}</Text>
              {onQueryUsage ? (
                <Pressable
                  className={isQueryingUsage ? 'mt-3 self-end rounded-full bg-[#dbeafe] px-3 py-2' : 'mt-3 self-end rounded-full bg-[#e7dfcf] px-3 py-2'}
                  disabled={isQueryingUsage}
                  onPress={(event) => {
                    event.stopPropagation();
                    onQueryUsage(account.id);
                  }}
                >
                  <View className="flex-row items-center gap-1.5">
                    <Animated.View style={isQueryingUsage ? usageQuerySpinStyle : undefined}>
                      <RefreshCw color={isQueryingUsage ? '#1d4ed8' : '#4e463e'} size={13} />
                    </Animated.View>
                    <Text className={isQueryingUsage ? 'text-xs font-semibold text-[#1d4ed8]' : 'text-xs font-semibold text-[#4e463e]'}>
                      查询
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          </View>
          {usageQueryError ? <Text className="text-xs text-[#a4512b]">用量查询失败：{usageQueryError}</Text> : null}

          <Text className="text-xs text-[#7d7468]">优先级 {account.priority ?? 0} · 倍率 {(account.rate_multiplier ?? 1).toFixed(2)}x</Text>
          <Text className="text-xs text-[#7d7468]" numberOfLines={1}>分组 {groupsText}</Text>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <View className={isBusy ? 'rounded-lg bg-[#fff0b8] px-2 py-1' : 'rounded-lg bg-[#f1ece2] px-2 py-1'}>
              <Text className={isBusy ? 'text-xs font-semibold text-[#a66a00]' : 'text-xs text-[#7d7468]'}>容量 {capacityText}</Text>
            </View>
            <Text className="text-xs text-[#7d7468]" numberOfLines={1}>· 创建时间 {createdAtText}</Text>
          </View>
          {accountErrorMessage ? <Text className="text-xs text-[#a4512b]">异常信息：{accountErrorMessage}</Text> : null}

          {children}
        </View>
      </ListCard>
    </View>
  );
}
