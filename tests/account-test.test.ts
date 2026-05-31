import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAccountTestResponse, parseAccountTestStream, parseServerSentEvents } from '../src/lib/account-test';

describe('account test response parsing', () => {
  it('parses server-sent test events', () => {
    const events = parseServerSentEvents([
      'data: {"type":"test_start","model":"gpt-5.5"}',
      '',
      'data: {"type":"content","text":"Hi"}',
      '',
      'data: {"type":"content","text":"!"}',
      '',
    ].join('\n'));

    assert.deepEqual(events, [
      { type: 'test_start', model: 'gpt-5.5' },
      { type: 'content', text: 'Hi' },
      { type: 'content', text: '!' },
    ]);
  });

  it('builds a successful test result from streamed content', () => {
    const result = parseAccountTestStream([
      'data: {"type":"test_start","model":"claude-sonnet-4-5"}',
      '',
      'data: {"type":"content","text":"Hi"}',
      '',
      'data: {"type":"content","text":" there"}',
      '',
    ].join('\n'));

    assert.deepEqual(result, {
      ok: true,
      prompt: 'hi',
      model: 'claude-sonnet-4-5',
      responseText: 'Hi there',
      error: undefined,
    });
  });

  it('keeps upstream API errors from streamed test events', () => {
    const result = parseAccountTestResponse({
      status: 200,
      ok: true,
      contentType: 'text/event-stream',
      text: [
        'data: {"type":"test_start","model":"gpt-5.5"}',
        '',
        'data: {"type":"error","error":"API returned 429: usage_limit_reached"}',
        '',
      ].join('\n'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.model, 'gpt-5.5');
    assert.equal(result.error, 'API returned 429: usage_limit_reached');
    assert.equal(result.httpStatus, 200);
  });

  it('falls back to admin JSON error parsing', () => {
    const result = parseAccountTestResponse({
      status: 400,
      ok: false,
      contentType: 'application/json',
      text: '{"code":1,"message":"bad request"}',
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'bad request');
  });
});
