import { Pressable, Text, View } from 'react-native';

import {
  formatIpLocation,
  formatReasoningEffort,
  getApiKeyDailyLimitProgress,
} from '@/src/lib/api-key-usage';
import type { IpInfoResponse } from '@/src/services/ipinfo';
import type { AdminApiKey, AdminUsageLog, UsageStats } from '@/src/types/admin';

const colors = {
  card: '#fbf8f2',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  primary: '#1d5f55',
  errorBg: '#f7e1d6',
  errorText: '#a4512b',
  muted: '#f7f1e6',
};

function formatMoney(value?: number | null) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function formatUsageCost(stats?: { total_account_cost?: number | null; total_actual_cost?: number | null; total_cost?: number | null }) {
  const value = Number(stats?.total_account_cost ?? stats?.total_actual_cost ?? stats?.total_cost ?? 0);
  return `$${value.toFixed(4)}`;
}

function getUsageCostValue(stats?: { total_account_cost?: number | null; total_actual_cost?: number | null; total_cost?: number | null }) {
  const value = Number(stats?.total_account_cost ?? stats?.total_actual_cost ?? stats?.total_cost ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatTime(value?: string | null) {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function formatModel(log?: AdminUsageLog | null) {
  if (!log) return '--';

  if (log.model_mapping_chain?.includes('→')) {
    return log.model_mapping_chain;
  }

  if (log.upstream_model && log.model && log.upstream_model !== log.model) {
    return `${log.model} → ${log.upstream_model}`;
  }

  return log.model || '--';
}

function StatusBadge({ text }: { text: string }) {
  const normalized = text.toLowerCase();
  const backgroundColor = normalized === 'active' ? '#dff4ea' : normalized === 'inactive' || normalized === 'disabled' ? '#ece5da' : colors.errorBg;
  const color = normalized === 'active' ? '#17663f' : normalized === 'inactive' || normalized === 'disabled' ? colors.subtext : colors.errorText;

  return (
    <View style={{ backgroundColor, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

function CopyInlineButton({ copied, onPress }: { copied: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginLeft: 8,
        backgroundColor: copied ? '#dff4ea' : '#e7dfcf',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: copied ? '#17663f' : '#4e463e' }}>{copied ? '已复制' : '复制'}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const content = (
    <>
      <Text style={{ fontSize: 12, color: colors.subtext }}>{label}</Text>
      <Text style={{ marginTop: 6, fontSize: 16, fontWeight: '700', color: colors.text }}>{value}</Text>
    </>
  );
  const style = {
    flex: 1,
    backgroundColor: colors.muted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.78 : 1 }]}>
        {content}
      </Pressable>
    );
  }

  return <View style={style}>{content}</View>;
}

function DailyLimitMetricCard({ item, todayUsage, loading }: { item: AdminApiKey; todayUsage?: UsageStats; loading?: boolean }) {
  const todayCost = getUsageCostValue(todayUsage);
  const progress = getApiKeyDailyLimitProgress(item, loading ? 0 : todayCost);

  if (!progress) {
    return <MetricCard label="今日花费" value={loading ? '加载中' : formatUsageCost(todayUsage)} />;
  }

  const progressColor = progress.exceeded ? colors.errorText : progress.warning ? '#c68a1f' : '#269b62';
  const amountText = loading ? '加载中' : `${formatMoney(progress.used)} / ${formatMoney(progress.limit)}`;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.muted,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.subtext }}>今日花费</Text>
      <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 13, color: colors.subtext }}>1d</Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{ flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.text }}
        >
          {amountText}
        </Text>
      </View>
      <View style={{ marginTop: 7, height: 6, borderRadius: 999, backgroundColor: '#dedbd7', overflow: 'hidden' }}>
        <View style={{ width: `${loading ? 0 : progress.cappedPercent}%`, height: '100%', borderRadius: 999, backgroundColor: progressColor }} />
      </View>
    </View>
  );
}

function DetailButton({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        backgroundColor: expanded ? colors.primary : colors.border,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: expanded ? '#fff' : '#4e463e' }}>{expanded ? '收起' : '详情'}</Text>
    </Pressable>
  );
}

function DetailField({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <View
      style={{
        width: wide ? '100%' : '48.5%',
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingHorizontal: 11,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext }}>{label}</Text>
      <Text
        style={{
          marginTop: 5,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: wide ? '500' : '700',
          color: colors.text,
          fontFamily: mono ? 'monospace' : undefined,
        }}
      >
        {value || '--'}
      </Text>
    </View>
  );
}

function getIpLocationDisplay(log?: AdminUsageLog | null, ipInfo?: IpInfoResponse | null) {
  const ipInfoLocation = formatIpLocation(ipInfo);
  if (ipInfoLocation !== '--') return ipInfoLocation;

  return formatIpLocation(log);
}

function LatestAccessDetails({
  log,
  ipInfo,
  ipLocationLoading,
  ipLocationError,
  loading,
  error,
}: {
  log?: AdminUsageLog | null;
  ipInfo?: IpInfoResponse | null;
  ipLocationLoading?: boolean;
  ipLocationError?: boolean;
  loading?: boolean;
  error?: boolean;
}) {
  if (loading) {
    return (
      <View style={{ marginTop: 12, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 13, color: colors.subtext }}>正在加载最后一次访问详情...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ marginTop: 12, backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
        <Text style={{ fontSize: 13, color: colors.errorText }}>最后一次访问详情加载失败</Text>
      </View>
    );
  }

  if (!log) {
    return (
      <View style={{ marginTop: 12, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 13, color: colors.subtext }}>暂无访问记录。</Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 12, backgroundColor: '#efe8dc', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>最后一次访问详情</Text>
        <Text style={{ fontSize: 11, color: colors.subtext }}>{formatTime(log.created_at)}</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 10 }}>
        <DetailField label="模型" value={formatModel(log)} />
        <DetailField label="推理强度" value={formatReasoningEffort(log.reasoning_effort)} />
        <DetailField label="IP地址" value={log.ip_address || '--'} mono />
        <DetailField
          label="IP归属地"
          value={ipLocationLoading ? '加载中' : ipLocationError ? getIpLocationDisplay(log) : getIpLocationDisplay(log, ipInfo)}
        />
        <DetailField label="User-Agent" value={log.user_agent || '--'} wide />
      </View>
    </View>
  );
}

export function ApiKeyCard({
  item,
  copied,
  onCopy,
  todayUsage,
  monthUsage,
  usageLoading,
  usageError,
  onPressMonthUsage,
  detailsExpanded,
  onToggleDetails,
  latestAccessLog,
  latestAccessIpInfo,
  latestAccessLoading,
  latestAccessError,
  latestAccessIpInfoLoading,
  latestAccessIpInfoError,
}: {
  item: AdminApiKey;
  copied: boolean;
  onCopy: () => void;
  todayUsage?: UsageStats;
  monthUsage?: UsageStats;
  usageLoading?: boolean;
  usageError?: boolean;
  onPressMonthUsage?: () => void;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
  latestAccessLog?: AdminUsageLog | null;
  latestAccessIpInfo?: IpInfoResponse | null;
  latestAccessLoading?: boolean;
  latestAccessError?: boolean;
  latestAccessIpInfoLoading?: boolean;
  latestAccessIpInfoError?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.muted,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{item.name || `Key #${item.id}`}</Text>
            <CopyInlineButton copied={copied} onPress={onCopy} />
          </View>
          <Text style={{ marginTop: 4, fontSize: 12, color: colors.subtext }}>{item.group?.name || '未分组'}</Text>
        </View>
        <StatusBadge text={item.status || '--'} />
      </View>

      <Text style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: colors.text }}>{item.key || '--'}</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <DailyLimitMetricCard item={item} todayUsage={todayUsage} loading={usageLoading} />
        <MetricCard label="近30天花费" value={usageLoading ? '加载中' : formatUsageCost(monthUsage)} onPress={onPressMonthUsage} />
      </View>
      {usageError ? <Text style={{ marginTop: 8, fontSize: 12, color: colors.errorText }}>部分用量加载失败</Text> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>访问属性</Text>
          <View style={{ marginTop: 5 }}>
            <DetailButton expanded={detailsExpanded} onPress={onToggleDetails} />
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>最后使用时间</Text>
          <Text style={{ marginTop: 4, fontSize: 13, color: colors.subtext }}>{formatTime(item.last_used_at)}</Text>
        </View>
      </View>

      {detailsExpanded ? (
        <LatestAccessDetails
          log={latestAccessLog}
          ipInfo={latestAccessIpInfo}
          ipLocationLoading={latestAccessIpInfoLoading}
          ipLocationError={latestAccessIpInfoError}
          loading={latestAccessLoading}
          error={latestAccessError}
        />
      ) : null}
    </View>
  );
}
