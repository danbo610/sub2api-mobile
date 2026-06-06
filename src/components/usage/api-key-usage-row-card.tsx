import { Text, View } from 'react-native';

import { formatCost, formatInteger, formatTokenValue } from '@/src/lib/formatters';
import type { UsageMetricTotals } from '@/src/lib/api-key-usage';

const colors = {
  card: '#fbf8f2',
  muted: '#f1ece2',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  accentText: '#8c5a22',
};

function MetricCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View
      style={{
        width: '31.5%',
        minWidth: 92,
        backgroundColor: colors.muted,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginTop: 5, fontSize: 14, fontWeight: '800', color: accent ? colors.accentText : colors.text }}>
        {value}
      </Text>
    </View>
  );
}

export function ApiKeyUsageRowCard({
  title,
  subtitle,
  subtitleLines,
  totals,
  index,
}: {
  title: string;
  subtitle?: string;
  subtitleLines?: string[];
  totals: UsageMetricTotals;
  index?: number;
}) {
  const visibleSubtitleLines = subtitleLines?.filter(Boolean) ?? [];

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
            {title}
          </Text>
          {visibleSubtitleLines.length > 0 ? (
            <View style={{ marginTop: 4, gap: 2 }}>
              {visibleSubtitleLines.map((line) => (
                <Text key={line} numberOfLines={1} style={{ fontSize: 12, color: colors.subtext }}>
                  {line}
                </Text>
              ))}
            </View>
          ) : subtitle ? (
            <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 12, color: colors.subtext }}>{subtitle}</Text>
          ) : null}
        </View>
        {typeof index === 'number' ? (
          <View style={{ backgroundColor: colors.muted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: colors.subtext }}>#{index}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <MetricCell label="总成本" value={formatCost(totals.cost)} accent />
        <MetricCell label="总请求" value={formatInteger(totals.requests)} />
        <MetricCell label="总 Token" value={formatTokenValue(totals.totalTokens)} />
        <MetricCell label="输入 Token" value={formatTokenValue(totals.inputTokens)} />
        <MetricCell label="缓存读取" value={formatTokenValue(totals.cacheReadTokens)} />
        <MetricCell label="输出 Token" value={formatTokenValue(totals.outputTokens)} />
      </View>
    </View>
  );
}
