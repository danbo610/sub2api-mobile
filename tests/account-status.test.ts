import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAccountError, getAccountErrorMessage, getAccountVisualStatus } from '../src/lib/account-status';

describe('account visual status', () => {
  it('marks Codex usage-limited accounts as limited', () => {
    assert.deepEqual(
      getAccountVisualStatus({
        status: 'active',
        schedulable: true,
        extra: { codex_7d_used_percent: 100 },
      }),
      { filterKey: 'limited', label: '限流', badgeTone: 'danger' }
    );
  });

  it('matches account list categories for active, paused, and error states', () => {
    assert.equal(getAccountVisualStatus({ status: 'active', schedulable: true }).filterKey, 'active');
    assert.equal(getAccountVisualStatus({ status: 'active', schedulable: false }).filterKey, 'paused');
    assert.equal(getAccountVisualStatus({ status: 'error', error_message: 'failed' }).filterKey, 'error');
  });

  it('detects error accounts from status or message', () => {
    assert.equal(getAccountError({ status: 'error' }), true);
    assert.equal(getAccountError({ status: 'ERROR' }), true);
    assert.equal(getAccountError({ error_message: 'failed' }), true);
    assert.equal(getAccountError({ status: 'active' }), false);
  });

  it('formats error message even when backend omits detail', () => {
    assert.equal(getAccountErrorMessage({ status: 'error', error_message: 'failed' }), 'failed');
    assert.equal(getAccountErrorMessage({ status: 'error' }), '账号状态异常，后台未返回详细原因');
    assert.equal(getAccountErrorMessage({ status: 'active' }), '');
  });
});
