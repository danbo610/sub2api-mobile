function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function getProviderErrorPayload(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const errorRecord = asRecord(record.error);
  return errorRecord ? { error: errorRecord } : null;
}

export function formatAdminFetchError(payload: unknown, rawText: string, status: number, fallback = 'REQUEST_FAILED') {
  const record = asRecord(payload);
  const reason = asText(record?.reason);
  const message = asText(record?.message);

  if (message && message !== fallback) {
    return reason && reason !== message ? `${message}\n${reason}` : message;
  }

  if (reason) {
    return reason;
  }

  const providerPayload = getProviderErrorPayload(payload);
  if (providerPayload) {
    const formatted = formatJson(providerPayload);
    return status > 0 ? `HTTP ${status}\n${formatted}` : formatted;
  }

  const raw = rawText.trim();
  if (raw) {
    return status > 0 ? `HTTP ${status}\n${raw}` : raw;
  }

  return fallback;
}
