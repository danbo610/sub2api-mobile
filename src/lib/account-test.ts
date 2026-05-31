export type AccountTestResult = {
  ok: boolean;
  prompt: string;
  model?: string;
  selectedModelId?: string;
  selectedModelName?: string;
  responseText?: string;
  error?: string;
  httpStatus?: number;
  contentType?: string | null;
};

type AccountTestEvent = Record<string, unknown>;

const DEFAULT_TEST_PROMPT = 'hi';

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringifyError(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return `${value}`;
  }
}

export function parseServerSentEvents(rawText: string): AccountTestEvent[] {
  return rawText
    .split(/\r?\n\r?\n/)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();

      if (!data || data === '[DONE]') {
        return [];
      }

      try {
        return [JSON.parse(data) as AccountTestEvent];
      } catch {
        return [{ type: 'raw', text: data }];
      }
    });
}

export function parseAccountTestStream(rawText: string): AccountTestResult {
  const events = parseServerSentEvents(rawText);
  const contentParts: string[] = [];
  let model: string | undefined;
  let error: string | undefined;

  events.forEach((event) => {
    const type = getString(event.type);

    if (type === 'test_start') {
      model = getString(event.model) ?? model;
      return;
    }

    if (type === 'content') {
      const text = getString(event.text);
      if (text !== undefined) {
        contentParts.push(text);
      }
      return;
    }

    if (type === 'error') {
      error = stringifyError(event.error) ?? stringifyError(event.message) ?? error;
    }
  });

  const responseText = contentParts.join('');

  return {
    ok: !error,
    prompt: DEFAULT_TEST_PROMPT,
    model,
    responseText: responseText || undefined,
    error,
  };
}

function parseJsonAccountTestResponse(json: unknown): AccountTestResult {
  const object = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const data = object.data && typeof object.data === 'object' ? object.data as Record<string, unknown> : object;
  const code = typeof object.code === 'number' ? object.code : undefined;
  const error = code !== undefined && code !== 0
    ? stringifyError(object.reason) ?? stringifyError(object.message) ?? 'REQUEST_FAILED'
    : stringifyError(data.error) ?? stringifyError(object.error);

  return {
    ok: !error,
    prompt: DEFAULT_TEST_PROMPT,
    model: getString(data.model) ?? getString(object.model),
    responseText: getString(data.response) ?? getString(data.text) ?? getString(data.content),
    error,
  };
}

export function parseAccountTestResponse(input: {
  text: string;
  status?: number;
  ok?: boolean;
  contentType?: string | null;
}): AccountTestResult {
  const contentType = input.contentType ?? '';
  let result: AccountTestResult;

  if (contentType.includes('text/event-stream') || input.text.trimStart().startsWith('data:')) {
    result = parseAccountTestStream(input.text);
  } else {
    try {
      result = parseJsonAccountTestResponse(JSON.parse(input.text));
    } catch {
      result = {
        ok: Boolean(input.ok),
        prompt: DEFAULT_TEST_PROMPT,
        responseText: input.ok ? input.text.trim() || undefined : undefined,
        error: input.ok ? undefined : input.text.trim() || `HTTP ${input.status ?? 'ERROR'}`,
      };
    }
  }

  if (input.ok === false && !result.error) {
    result = {
      ...result,
      ok: false,
      error: `HTTP ${input.status ?? 'ERROR'}`,
    };
  }

  return {
    ...result,
    httpStatus: input.status,
    contentType: input.contentType,
  };
}
