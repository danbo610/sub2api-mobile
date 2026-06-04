import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOpenAIOAuthCredentials,
  buildOpenAIOAuthExtra,
  extractOAuthCode,
  extractOAuthState,
  parseOAuthState,
} from '../src/lib/account-oauth';

describe('OpenAI account OAuth helpers', () => {
  it('parses OAuth state from generated auth URL', () => {
    assert.equal(parseOAuthState('https://auth.example/authorize?client_id=abc&state=STATE-1'), 'STATE-1');
    assert.equal(parseOAuthState('not a url'), '');
  });

  it('extracts code and state from pasted callback URL or query text', () => {
    assert.equal(extractOAuthCode('https://example.test/callback?code=CODE-1&state=STATE-1'), 'CODE-1');
    assert.equal(extractOAuthState('code=CODE-2&state=STATE-2'), 'STATE-2');
    assert.equal(extractOAuthCode('CODE-ONLY'), 'CODE-ONLY');
  });

  it('builds credentials without overwriting absent refresh token fields', () => {
    assert.deepEqual(
      buildOpenAIOAuthCredentials({
        access_token: 'access-token',
        expires_at: 1760000000,
        email: 'user@example.com',
        plan_type: 'plus',
        client_id: 'client-id',
      }),
      {
        access_token: 'access-token',
        expires_at: 1760000000,
        email: 'user@example.com',
        plan_type: 'plus',
        client_id: 'client-id',
      }
    );
  });

  it('builds extra only from display metadata', () => {
    assert.deepEqual(
      buildOpenAIOAuthExtra({
        email: 'user@example.com',
        name: 'User',
        privacy_mode: 'enabled',
        access_token: 'access-token',
      }),
      {
        email: 'user@example.com',
        name: 'User',
        privacy_mode: 'enabled',
      }
    );
    assert.equal(buildOpenAIOAuthExtra({ access_token: 'access-token' }), undefined);
  });
});
