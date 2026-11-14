import assert from 'node:assert/strict';
import worker, { handleRequest } from './worker/index.js';

// Adapted from the supplied starter test. Every network call is mocked.
const nomiId = '00000000-0000-4000-8000-000000000001';
const key = 'mock-server-secret';
const calls = [];
const diagnosticLogs = [];
const originalError = console.error;
console.error = line => diagnosticLogs.push(JSON.parse(line));
const sentMessage = { uuid: '00000000-0000-4000-8000-000000000002', text: 'Hello!' };
const replyMessage = { text: 'Actual upstream reply', uuid: 'reply-id' };
const mockFetch = async (url, options) => {
  calls.push({ url, options });
  return Response.json(url.endsWith('/nomis')
    ? { nomis: [{ name: 'Test Nomi', uuid: nomiId, gender: 'Female' }] }
    : { sentMessage, replyMessage });
};
async function rpc(method, params = {}, env = { NOMI_API_KEY: key }, fetchFn = mockFetch) {
  const response = await handleRequest(new Request('https://bridge.test/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env, fetchFn);
  assert.equal(response.status, 200);
  return response.json();
}
assert.deepEqual((await rpc('server/discover')).result.supportedVersions, ['2026-07-28']);
const tools = (await rpc('tools/list')).result.tools;
assert.deepEqual(tools.map(t => t.name), ['list_nomis', 'message_nomi']);
assert.equal(tools[1].annotations.readOnlyHint, false);
assert.equal(tools[1].annotations.idempotentHint, false);
assert.equal(calls.length, 0, 'Discovery must never contact Nomi');

const list = await rpc('tools/call', { name: 'list_nomis', arguments: {} });
assert.deepEqual(JSON.parse(list.result.content[0].text), [{ name: 'Test Nomi', uuid: nomiId }]);
assert.equal(calls[0].url, 'https://api.nomi.ai/v1/nomis');
assert.equal(calls[0].options.headers.Authorization, key);

const message = await rpc('tools/call', { name: 'message_nomi', arguments: { nomi_id: nomiId, message: 'Hello!' } });
assert.deepEqual(JSON.parse(message.result.content[0].text), {
  nomiId, sent: 'Hello!', reply: 'Actual upstream reply', replyId: 'reply-id',
});
assert.equal(calls[1].url, `https://api.nomi.ai/v1/nomis/${nomiId}/chat`);
assert.equal(calls[1].options.method, 'POST');
assert.equal(calls[1].options.redirect, 'manual');
assert.equal(calls[1].options.headers.Authorization, key);
assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
assert.deepEqual(JSON.parse(calls[1].options.body), { messageText: 'Hello!' });

assert.equal((await rpc('tools/call', { name: 'list_nomis' }, {})).result.isError, true);
assert.equal((await rpc('tools/call', { name: 'message_nomi', arguments: { nomi_id: '../other', message: 'Hello!' } })).result.isError, true);
assert.equal(calls.length, 2, 'Invalid input and missing credentials must not contact Nomi');
let failedSends = 0;
const failure = await rpc('tools/call', { name: 'message_nomi', arguments: { nomi_id: nomiId, message: 'Hello!' } }, { NOMI_API_KEY: key }, async () => {
  failedSends++;
  return new Response('upstream body must not leak', { status: 500 });
});
assert.equal(failure.result.isError, true);
assert.equal(failedSends, 1, 'Message sends must never retry automatically');
assert.ok(!JSON.stringify(failure).includes('upstream body'));
assert.equal(JSON.parse(failure.result.content[0].text).deliveryStatus, 'unknown');
assert.equal((await rpc('tools/call', { name: 'unknown' })).error.code, -32602);

// Each case makes exactly one mocked request. No live messages or recovery calls.
const messageArgs = { name: 'message_nomi', arguments: { nomi_id: nomiId, message: 'Hello!' } };
const cases = [
  { name: 'NoReply does not prove delivery', status: 500, body: { error: { type: 'NoReply', privateText: 'private body sentinel' } }, delivery: 'unknown', reply: 'unavailable', errorType: 'NoReply' },
  { name: 'documented rejection', status: 400, body: { error: { type: 'InvalidBody' } }, delivery: 'not_sent', reply: 'not_requested', errorType: 'InvalidBody' },
  { name: 'server error with rejection type remains uncertain', status: 500, body: { error: { type: 'InvalidBody' } }, delivery: 'unknown', reply: 'unavailable', errorType: 'InvalidBody' },
  { name: 'delivery receipt without reply', status: 200, body: { sentMessage }, delivery: 'confirmed', reply: 'unavailable' },
  { name: 'delivery receipt in error body', status: 500, body: { sentMessage, error: { type: 'NoReply' } }, delivery: 'confirmed', reply: 'unavailable', errorType: 'NoReply' },
  { name: 'reply preserved from same error response', status: 500, body: { sentMessage, replyMessage }, delivery: 'confirmed', reply: 'received' },
  { name: 'mismatched receipt is not evidence for this message', status: 500, body: { sentMessage: { ...sentMessage, text: 'other message' }, replyMessage }, delivery: 'unknown', reply: 'unavailable' },
  { name: 'invalid success body', status: 200, body: { error: { type: 'Unrecognized private body sentinel' } }, delivery: 'unknown', reply: 'unavailable' },
];
for (const c of cases) {
  let sends = 0;
  const response = await rpc('tools/call', messageArgs, { NOMI_API_KEY: key }, async () => {
    sends++;
    return Response.json(c.body, { status: c.status, headers: { 'x-request-id': 'safe-request-id' } });
  });
  assert.equal(sends, 1, c.name);
  assert.equal(response.result.isError, true, c.name);
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.deliveryStatus, c.delivery, c.name);
  assert.equal(report.replyStatus, c.reply, c.name);
  assert.equal(report.httpStatus, c.status, c.name);
  assert.equal(report.errorType, c.errorType, c.name);
  assert.equal(report.upstreamRequestId, 'safe-request-id');
  if (c.reply === 'received') assert.equal(report.reply, replyMessage.text);
}
for (const status of [200, 500]) {
  const response = await rpc('tools/call', messageArgs, { NOMI_API_KEY: key }, async () => new Response('<html>private body sentinel</html>', { status }));
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.deliveryStatus, 'unknown');
  assert.equal(report.responseFormat, 'non_json');
  assert.ok(!JSON.stringify(response).includes('private body sentinel'));
}
for (const failureMode of ['network', 'body']) {
  let sends = 0;
  const response = await rpc('tools/call', messageArgs, { NOMI_API_KEY: key }, async () => {
    sends++;
    if (failureMode === 'network') throw new Error('private body sentinel');
    return { ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error('private body sentinel'); } };
  });
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.deliveryStatus, 'unknown');
  assert.equal(sends, 1);
  assert.ok(!JSON.stringify(response).includes('private body sentinel'));
}
let preflightSends = 0;
for (const [args, env] of [[{ ...messageArgs, arguments: { nomi_id: nomiId, message: '' } }, { NOMI_API_KEY: key }], [messageArgs, {}]]) {
  const response = await rpc('tools/call', args, env, async () => { preflightSends++; });
  assert.equal(JSON.parse(response.result.content[0].text).deliveryStatus, 'not_sent');
}
assert.equal(preflightSends, 0);
const logged = JSON.stringify(diagnosticLogs);
for (const privateValue of [key, nomiId, sentMessage.text, replyMessage.text, 'private body sentinel']) assert.ok(!logged.includes(privateValue), 'Diagnostics must exclude credentials, identities, and conversation content');
assert.ok(diagnosticLogs.every(log => log.event === 'nomi_message_error'));

const page = await handleRequest(new Request('https://bridge.test/'), { NOMI_API_KEY: key }, mockFetch);
const html = await page.text();
assert.ok(html.includes('Server-side key configured'));
assert.ok(html.includes('Nomi connection verified: 1 companions available.'));
assert.ok(!html.includes(key), 'The secret must never reach the browser');
assert.equal((await handleRequest(new Request('https://bridge.test/mcp'), {})).status, 405);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = mockFetch;
  const deployed = await worker.fetch(new Request('https://bridge.test/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_nomis' } }),
  }), { NOMI_API_KEY: key }, { waitUntil() {} });
  assert.ok(!(await deployed.json()).result.isError, 'Worker execution context must not replace the fetch function');
} finally { globalThis.fetch = originalFetch; }
console.error = originalError;
console.log('PASS: existing MCP contract, delivery/reply evidence, upstream error parsing, malformed/unreadable responses, no retries, and private diagnostics (mock network only).');
