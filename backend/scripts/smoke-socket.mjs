/**
 * Socket.IO smoke test.
 *
 * Verifies handshake authentication, automatic board-room membership, and that a mutation made
 * over REST reaches a connected client as a broadcast hint.
 *
 * Run with: node scripts/smoke-socket.mjs
 */

import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

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

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function login(identifier, clientType, deviceId) {
  const result = await call('POST', '/auth/login', {
    body: { identifier, password: PASSWORD, deviceId, clientType },
  });
  if (result.status !== 200) throw new Error(`login failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

/** Resolves with the first matching event, or null after `timeoutMs`. */
function waitForEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 6000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

async function main() {
  console.log('\nSocket.IO authentication');

  let rejected = false;
  try {
    await connect(undefined);
  } catch (error) {
    rejected = true;
    check('unauthenticated handshake refused', error.message === 'UNAUTHENTICATED', error.message);
  }
  if (!rejected) check('unauthenticated handshake refused', false, 'connection succeeded');

  try {
    await connect('not-a-real-token');
    check('invalid token refused', false, 'connection succeeded');
  } catch (error) {
    check('invalid token refused', error.message === 'UNAUTHENTICATED', error.message);
  }

  const session = await login('user1', 'ANDROID', 'smoke-socket-user1');
  const socket = await connect(session.tokens.accessToken);
  check('authenticated handshake accepted', socket.connected);

  console.log('\nBroadcast delivery');

  // Give the server a moment to finish joining the board rooms it looks up on connect.
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Must be an ACTIVE board: an archived one refuses new orders, and the REST smoke run
  // archives boards, so taking data[0] blindly made this suite fail depending on run order.
  const boards = await call('GET', '/boards?status=ACTIVE', { token: session.tokens.accessToken });
  const board = boards.body.data[0];
  check('an active board is available for the broadcast test', Boolean(board), boards.body);
  const activities = await call('GET', '/activity-types', { token: session.tokens.accessToken });
  const lunch = activities.body.data.find((a) => a.name === 'Lunch') ?? activities.body.data[0];
  const items = await call('GET', '/menu-items?pageSize=1', { token: session.tokens.accessToken });

  const orderChanged = waitForEvent(socket, 'order:changed');

  const orderId = randomUUID();
  const create = await call('POST', '/orders', {
    token: session.tokens.accessToken,
    body: {
      id: orderId,
      boardId: board.id,
      activityTypeId: lunch.id,
      venue: 'Socket Test Venue',
      pax: 12,
      requiredDate: '2026-08-08',
      requiredTime: '11:00',
      items: [{ menuItemId: items.body.data[0].id, quantity: 2 }],
    },
  });
  check('order created for broadcast test', create.status === 201, create.body);

  const event = await orderChanged;
  check('order:changed received', event !== null, event);
  check('event carries the board id', event?.boardId === board.id, event);
  check('event carries the order id', event?.orderId === orderId, event);
  check('event carries a sync cursor', typeof event?.cursor === 'number', event);
  check(
    'event carries no entity data, only a hint',
    event !== null && !('venue' in event) && !('items' in event),
    event,
  );

  console.log('\nNotification room');

  // A thread reply notifies thread participants — prior authors plus the order creator — not every
  // board member, which would be unusably noisy. user1 created the order above, so a reply from
  // user2 must reach user1's personal room.
  const other = await login('user2', 'ANDROID', 'smoke-socket-user2');

  const notified = waitForEvent(socket, 'notification:created');
  const reply = await call('POST', `/orders/${orderId}/thread`, {
    token: other.tokens.accessToken,
    body: { body: 'Socket notification test' },
  });
  check('reply posted by second member', reply.status === 201, reply.body);

  const notification = await notified;
  check('notification:created reached the order creator', notification !== null, notification);
  check(
    'notification hint carries an id',
    typeof notification?.notificationId === 'string',
    notification,
  );

  // A mention must reach a member who is not otherwise a participant.
  const thirdSocket = await connect(other.tokens.accessToken);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const mentionNotified = waitForEvent(thirdSocket, 'notification:created');

  await call('POST', `/orders/${orderId}/thread`, {
    token: session.tokens.accessToken,
    body: { body: 'Mentioning you', mentionedUserIds: [other.user.id] },
  });

  const mention = await mentionNotified;
  check('mention notification delivered', mention !== null, mention);

  socket.close();
  thirdSocket.close();

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  console.log('-'.repeat(60));

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error('\nSocket smoke test crashed:', error);
  process.exit(1);
});
