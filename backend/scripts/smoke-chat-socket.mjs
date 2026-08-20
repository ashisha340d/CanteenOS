/**
 * Socket smoke test for admin↔counter messaging.
 *
 * The REST smoke (`smoke-chat.mjs`) proves the messages are stored and scoped correctly. This
 * one proves they actually *arrive* — which is the whole point of the feature, and the half a
 * code read cannot confirm:
 *
 *   - a message posted by the office lands on the counter's socket, tagged TO_COUNTER
 *   - the bell arrives on its own event, so a client can react to it differently
 *   - typing presence is relayed to the other side and not echoed to the sender
 *   - a client that never subscribed hears nothing — the proof that the chat room really is
 *     separate from the KDS board room it shadows
 *
 * Run with: node scripts/smoke-chat-socket.mjs
 */

import { io } from 'socket.io-client';
import { CHAT_SOCKET_EVENTS } from '@menuboard/shared';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4000';
const API = `${BASE}/api/v1`;
const PASSWORD = process.env.SEED_PASSWORD ?? 'MenuBoard@2026';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

async function call(method, path, { token, body, clientType } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (clientType !== undefined) headers['X-Client-Type'] = clientType;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function login(clientType) {
  const result = await call('POST', '/auth/login', {
    body: {
      identifier: 'admin',
      password: PASSWORD,
      deviceId: `smoke-chat-socket-${clientType}`,
      deviceName: 'chat socket smoke',
      clientType,
    },
  });
  if (result.status !== 200) throw new Error(`login failed: ${JSON.stringify(result.body)}`);
  return result.body.data.tokens.accessToken;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timed out')), 8_000);
  });
}

/** Collects every frame of an event, so an assertion can also be that nothing arrived. */
function record(socket, event) {
  const seen = [];
  socket.on(event, (payload) => seen.push(payload));
  return seen;
}

const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Counter chat socket smoke against ${BASE}`);

  const officeToken = await login('ADMIN');
  const counterToken = await login('KDS');

  const counters = await call('GET', '/kds/counters', { token: officeToken });
  const counterId = counters.body?.data?.[0]?.id;
  if (counterId === undefined) {
    console.log('No counters configured — seed one and re-run.');
    process.exit(1);
  }

  const office = await connect(officeToken);
  const counter = await connect(counterToken);
  // Never subscribes to anything: the control that proves room scoping.
  const bystander = await connect(officeToken);
  check('all three sockets authenticated', office.connected && counter.connected && bystander.connected);

  const counterMessages = record(counter, CHAT_SOCKET_EVENTS.CHAT_MESSAGE);
  const counterBells = record(counter, CHAT_SOCKET_EVENTS.CHAT_BELL);
  const officeMessages = record(office, CHAT_SOCKET_EVENTS.CHAT_MESSAGE);
  const officeTyping = record(office, CHAT_SOCKET_EVENTS.CHAT_TYPING);
  const counterTyping = record(counter, CHAT_SOCKET_EVENTS.CHAT_TYPING);
  const bystanderMessages = record(bystander, CHAT_SOCKET_EVENTS.CHAT_MESSAGE);

  office.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId });
  counter.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId });
  await settle();

  console.log('\nOffice writes');
  const body = `socket smoke ${Date.now()}`;
  await call('POST', `/counter-chat/${counterId}/messages`, { token: officeToken, body: { body } });
  await settle();

  const landed = counterMessages.find((m) => m.body === body);
  check('counter receives the message', landed !== undefined, counterMessages.length);
  check('message carries direction TO_COUNTER', landed?.direction === 'TO_COUNTER', landed?.direction);
  check('payload is the message itself, not a hint', typeof landed?.id === 'string' && landed?.body === body);
  check('the office sees its own message echoed back', officeMessages.some((m) => m.body === body));
  check('an unsubscribed socket hears nothing', bystanderMessages.length === 0, bystanderMessages.length);

  console.log('\nCounter answers');
  const reply = `counter reply ${Date.now()}`;
  await call('POST', `/counter-chat/${counterId}/messages`, {
    token: counterToken,
    body: { body: reply },
  });
  await settle();
  const back = officeMessages.find((m) => m.body === reply);
  check('office receives the reply', back !== undefined);
  check('reply carries direction TO_ADMIN', back?.direction === 'TO_ADMIN', back?.direction);

  console.log('\nBell');
  await call('POST', `/counter-chat/${counterId}/bell`, { token: officeToken });
  await settle();
  check('counter receives a bell event', counterBells.length >= 1, counterBells.length);
  check('bell carries kind BELL', counterBells.at(-1)?.kind === 'BELL');
  check('a bell is not also delivered as a message',
    !counterMessages.some((m) => m.kind === 'BELL'));

  console.log('\nHangup');
  const bellEnds = record(counter, CHAT_SOCKET_EVENTS.CHAT_BELL_END);
  const hangup = await call('POST', `/counter-chat/${counterId}/bell/hangup`, { token: officeToken });
  check('office can hang up', hangup.status === 200, hangup.body);
  await settle();
  check('counter receives the hangup', bellEnds.length >= 1, bellEnds.length);
  check('hangup names the counter', bellEnds.at(-1)?.counterId === counterId);
  const counterHangup = await call('POST', `/counter-chat/${counterId}/bell/hangup`, {
    token: counterToken,
  });
  check('a counter cannot hang up on itself', counterHangup.status >= 400, counterHangup.status);

  console.log('\nTyping presence');
  const typingBefore = counterTyping.length;
  office.emit(CHAT_SOCKET_EVENTS.CHAT_TYPING_SET, { counterId, typing: true });
  await settle();
  check('the counter sees the office typing', counterTyping.length > typingBefore, counterTyping.length);
  check('typing is attributed to TO_COUNTER', counterTyping.at(-1)?.direction === 'TO_COUNTER',
    counterTyping.at(-1)?.direction);
  check('the sender is not echoed its own typing', officeTyping.length === 0, officeTyping.length);

  console.log('\nUnsubscribe');
  counter.emit(CHAT_SOCKET_EVENTS.CHAT_UNSUBSCRIBE, { counterId });
  await settle();
  const countBefore = counterMessages.length;
  await call('POST', `/counter-chat/${counterId}/messages`, {
    token: officeToken,
    body: { body: `after unsubscribe ${Date.now()}` },
  });
  await settle();
  check('an unsubscribed counter stops receiving', counterMessages.length === countBefore,
    { before: countBefore, after: counterMessages.length });

  office.close();
  counter.close();
  bystander.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
