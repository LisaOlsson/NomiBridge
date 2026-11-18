import assert from 'node:assert/strict';
import { handleRequest } from './worker/index.js';

// All calls in this file use mocked fetch. No Nomi credentials or real messages.
const key = 'test-only-key';
const roomId = '00000000-0000-4000-8000-000000000010';
const nomiId = '00000000-0000-4000-8000-000000000011';
const sentId = '00000000-0000-4000-8000-000000000012';
const replyId = '00000000-0000-4000-8000-000000000013';
const room = { uuid: roomId, name: 'Test Room', status: 'Default', note: 'A friendly chat.',
  backchannelingEnabled: false, nomis: [{ uuid: nomiId, name: 'Test Nomi' }] };
const calls = [];
const mock = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/rooms') && options.method === 'POST') return Response.json(room, { status: 201 });
  if (url.endsWith('/rooms')) return Response.json({ rooms: [room] });
  if (url.endsWith('/chat/request')) return Response.json({ replyMessage: { uuid: replyId, text: 'I respond!', sent: '2026-11-18T12:00:00Z' } });
  return Response.json({ sentMessage: { uuid: sentId, text: 'Hello room!', sent: '2026-11-18T12:00:00Z' } });
};
async function rpc(name, args = {}, fetchFn = mock, env = { NOMI_API_KEY: key }) {
  const resp = await handleRequest(new Request('https://bridge.test/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), env, fetchFn);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  return body.result.isError ? { error: JSON.parse(body.result.content[0].text) } : { value: JSON.parse(body.result.content[0].text) };
}
const logs = [];
const originalError = console.error;
console.error = line => logs.push(JSON.parse(line));

const listed = await rpc('list_rooms');
assert.deepEqual(listed.value, [room]);
assert.equal(calls[0].url, 'https://api.nomi.ai/v1/rooms');
assert.equal(calls[0].options.headers.Authorization, key);

const created = await rpc('create_room', { name: room.name, note: room.note, nomi_ids: [nomiId], backchanneling_enabled: false });
assert.deepEqual(created.value, room);
assert.equal(calls[1].url, 'https://api.nomi.ai/v1/rooms');
assert.equal(calls[1].options.method, 'POST');
assert.equal(calls[1].options.redirect, 'manual');
assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
assert.deepEqual(JSON.parse(calls[1].options.body), { name: room.name, note: room.note, backchannelingEnabled: false, nomiUuids: [nomiId] });

const sent = await rpc('message_room', { room_id: roomId, message: 'Hello room!' });
assert.deepEqual(sent.value, { roomId, sent: 'Hello room!', sentId });
assert.equal(calls[2].url, `https://api.nomi.ai/v1/rooms/${roomId}/chat`);
assert.deepEqual(JSON.parse(calls[2].options.body), { messageText: 'Hello room!' });
assert.equal(calls.length, 3, 'Sending must not automatically request a reply');

const reply = await rpc('request_room_reply', { room_id: roomId, nomi_id: nomiId });
assert.deepEqual(reply.value, { roomId, nomiId, reply: 'I respond!', replyId });
assert.equal(calls[3].url, `https://api.nomi.ai/v1/rooms/${roomId}/chat/request`);
assert.deepEqual(JSON.parse(calls[3].options.body), { nomiUuid: nomiId });

const beforeInvalid = calls.length;
for (const [tool, args] of [
  ['create_room', { name: '', nomi_ids: [nomiId] }],
  ['create_room', { name: 'X', nomi_ids: [] }],
  ['create_room', { name: 'X', nomi_ids: [nomiId, nomiId] }],
  ['create_room', { name: 'X', nomi_ids: ['../fake'] }],
  ['create_room', { name: 'X', nomi_ids: [nomiId], note: 'x'.repeat(1001) }],
  ['create_room', { name: 'X', nomi_ids: [nomiId], backchanneling_enabled: 'yes' }],
  ['message_room', { room_id: '../bad', message: 'hello' }],
  ['message_room', { room_id: roomId, message: ' ' }],
  ['message_room', { room_id: roomId, message: 'x'.repeat(801) }],
  ['request_room_reply', { room_id: roomId, nomi_id: 'not-a-uuid' }],
]) {
  const result = await rpc(tool, args);
  assert.equal(result.error?.operationStatus, 'not_started', tool);
}
assert.equal(calls.length, beforeInvalid, 'Invalid room tool calls must not contact Nomi');

const noKey = await rpc('create_room', { name: 'X', nomi_ids: [nomiId] }, mock, {});
assert.equal(noKey.error.operationStatus, 'not_started');
assert.equal(calls.length, beforeInvalid, 'No key must not create a room');

for (const [name, tool, args, status, body, expected] of [
  ['room create rejected', 'create_room', { name: 'X', nomi_ids: [nomiId] }, 403, { error: { type: 'InsufficientPlan', secret: 'PRIVATE_DATA' } }, 'not_started'],
  ['room create status ambiguous', 'create_room', { name: 'X', nomi_ids: [nomiId] }, 500, { error: { type: 'NoResponseFromServer' } }, 'unknown'],
  ['room send NoReply', 'message_room', { room_id: roomId, message: 'Hello room!' }, 500, { error: { type: 'NoReply' } }, 'unknown'],
  ['room rejected before send', 'message_room', { room_id: roomId, message: 'Hello room!' }, 400, { error: { type: 'RoomStillCreating' } }, 'not_started'],
  ['room reply timed out', 'request_room_reply', { room_id: roomId, nomi_id: nomiId }, 500, { error: { type: 'NoReply', secret: 'PRIVATE_DATA' } }, 'unknown'],
  ['room reply rejected', 'request_room_reply', { room_id: roomId, nomi_id: nomiId }, 400, { error: { type: 'RoomNomiNotReadyForMessage' } }, 'not_started'],
  ['room sent receipt on HTTP 500', 'message_room', { room_id: roomId, message: 'Hello room!' }, 500,
    { sentMessage: { uuid: sentId, text: 'Hello room!' } }, 'confirmed'],
]) {
  let count = 0;
  const res = await rpc(tool, args, async () => { count++; return Response.json(body, { status }); });
  assert.equal(count, 1, name + ': do not retry');
  assert.equal(res.error.operationStatus, expected, name);
  assert.equal(res.error.httpStatus, status, name);
  assert.ok(!JSON.stringify(res).includes('PRIVATE_DATA'), name);
  if (name === 'room sent receipt on HTTP 500') assert.equal(res.error.sentId, sentId);
}
let failCount = 0;
const transportError = await rpc('request_room_reply', { room_id: roomId, nomi_id: nomiId }, async () => {
  failCount++; throw Error('PRIVATE_DATA');
});
assert.equal(failCount, 1);
assert.equal(transportError.error.operationStatus, 'unknown');
assert.ok(!JSON.stringify(transportError).includes('PRIVATE_DATA'));

const unrecognized = await rpc('message_room', { room_id: roomId, message: 'Hello room!' }, async () => new Response('<PRIVATE_DATA>', { status: 200 }));
assert.equal(unrecognized.error.operationStatus, 'unknown');
assert.equal(unrecognized.error.responseFormat, 'non_json');
assert.ok(!JSON.stringify(unrecognized).includes('PRIVATE_DATA'));
console.error = originalError;
for (const value of [key, roomId, nomiId, 'Hello room!', 'I respond!', 'PRIVATE_DATA']) {
  assert.ok(!JSON.stringify(logs).includes(value), 'Room diagnostics must not log private data');
}
console.log('PASS: Rooms discovery, creation, message receipts, targeted replies, input validation, unknown delivery, and no retries (mock network only).');
