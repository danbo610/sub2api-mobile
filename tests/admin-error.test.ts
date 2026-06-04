import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatAdminFetchError } from '../src/lib/admin-error';

describe('admin fetch error formatting', () => {
  it('keeps detailed provider error payloads visible', () => {
    const payload = {
      error: {
        message: 'Could not validate your token. Please try signing in again.',
        type: 'invalid_request_error',
        param: null,
        code: 'token_expired',
      },
    };

    const message = formatAdminFetchError(payload, JSON.stringify(payload), 401);

    assert.match(message, /HTTP 401/);
    assert.match(message, /Could not validate your token/);
    assert.match(message, /token_expired/);
  });

  it('keeps detailed sub2api messages ahead of short reason codes', () => {
    assert.equal(
      formatAdminFetchError({ code: 1, reason: 'INTERNAL_ERROR', message: 'token exchange failed: status 401' }, '', 400),
      'token exchange failed: status 401\nINTERNAL_ERROR'
    );
    assert.equal(formatAdminFetchError({ code: 1, reason: 'TOKEN_EXPIRED' }, '', 400), 'TOKEN_EXPIRED');
  });
});
