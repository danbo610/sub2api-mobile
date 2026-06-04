import type { OpenAIOAuthTokenInfo } from '@/src/types/admin';

export function parseOAuthState(authUrl: string) {
  try {
    return new URL(authUrl).searchParams.get('state') ?? '';
  } catch {
    return '';
  }
}

function getOAuthParam(input: string, key: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).searchParams.get(key) ?? '';
  } catch {
    if (!trimmed.includes('=')) {
      return '';
    }
  }

  const query = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed;
  return new URLSearchParams(query).get(key) ?? '';
}

export function extractOAuthCode(input: string) {
  const trimmed = input.trim();
  return getOAuthParam(trimmed, 'code') || trimmed;
}

export function extractOAuthState(input: string) {
  return getOAuthParam(input, 'state');
}

export function buildOpenAIOAuthCredentials(tokenInfo: OpenAIOAuthTokenInfo) {
  const credentials: Record<string, unknown> = {
    access_token: tokenInfo.access_token,
    expires_at: tokenInfo.expires_at,
  };

  if (tokenInfo.refresh_token) {
    credentials.refresh_token = tokenInfo.refresh_token;
  }
  if (tokenInfo.id_token) {
    credentials.id_token = tokenInfo.id_token;
  }
  if (tokenInfo.email) {
    credentials.email = tokenInfo.email;
  }
  if (tokenInfo.chatgpt_account_id) {
    credentials.chatgpt_account_id = tokenInfo.chatgpt_account_id;
  }
  if (tokenInfo.chatgpt_user_id) {
    credentials.chatgpt_user_id = tokenInfo.chatgpt_user_id;
  }
  if (tokenInfo.organization_id) {
    credentials.organization_id = tokenInfo.organization_id;
  }
  if (tokenInfo.plan_type) {
    credentials.plan_type = tokenInfo.plan_type;
  }
  if (tokenInfo.client_id) {
    credentials.client_id = tokenInfo.client_id;
  }

  return credentials;
}

export function buildOpenAIOAuthExtra(tokenInfo: OpenAIOAuthTokenInfo) {
  const extra: Record<string, string> = {};

  if (tokenInfo.email) {
    extra.email = tokenInfo.email;
  }
  if (tokenInfo.name) {
    extra.name = tokenInfo.name;
  }
  if (tokenInfo.privacy_mode) {
    extra.privacy_mode = tokenInfo.privacy_mode;
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}
