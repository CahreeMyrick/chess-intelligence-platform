import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonApiClient } from '../../public/js/shared/api-client.mjs';
import { ApiError } from '../../public/js/shared/errors.mjs';

function response({ status = 200, body = '', statusText = '' } = {}) {
  const responseBody = status === 204 || status === 205 || status === 304 ? null : body;
  return new Response(responseBody, { status, statusText });
}

test('POST serializes JSON and returns parsed response', async () => {
  let captured;
  const client = new JsonApiClient({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ body: JSON.stringify({ ok: true }) });
    },
  });
  const data = await client.post('/test', { value: 42 });
  assert.deepEqual(data, { ok: true });
  assert.equal(captured.url, '/test');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.body, '{"value":42}');
});

test('non-2xx response throws ApiError with server message', async () => {
  const client = new JsonApiClient({
    fetchImpl: async () => response({ status: 400, body: JSON.stringify({ error: 'Illegal move' }) }),
  });
  await assert.rejects(
    () => client.get('/bad'),
    (error) => error instanceof ApiError && error.status === 400 && error.message === 'Illegal move',
  );
});

test('successful empty response returns null', async () => {
  const client = new JsonApiClient({ fetchImpl: async () => response({ status: 204 }) });
  assert.equal(await client.get('/empty'), null);
});

test('invalid JSON is reported as an API contract failure', async () => {
  const client = new JsonApiClient({ fetchImpl: async () => response({ body: '<html>not json</html>' }) });
  await assert.rejects(() => client.get('/html'), /Expected JSON/);
});
