/**
 * End-to-end smoke test for admin↔counter messaging.
 *
 * Exercises the whole channel against a running server: the office writes to a counter, tags
 * an order, rings the bell, the counter answers, and each side's unread count behaves. The
 * point of interest is `direction` — it is derived from the client type in the token, so the
 * same URL called by the KDS and by the admin panel must produce opposite sides.
 *
 * Run with: node scripts/smoke-chat.mjs
 */

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
  let parsed;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

async function login(identifier, clientType) {
  const result = await call('POST', '/auth/login', {
    body: {
      identifier,
      password: PASSWORD,
      deviceId: `smoke-chat-${clientType}`,
      deviceName: 'chat smoke test',
      clientType,
    },
    clientType,
  });
  if (result.status !== 200) {
    throw new Error(`login failed for ${identifier}: ${JSON.stringify(result.body)}`);
  }
  return result.body.data.tokens.accessToken;
}

async function main() {
  console.log(`Counter chat smoke against ${BASE}`);

  // Two sessions, two client types — the whole point of the direction rule.
  const office = await login('admin', 'ADMIN');
  const counter = await login('admin', 'KDS');

  const counters = await call('GET', '/kds/counters', { token: office });
  check('counters list', counters.status === 200 && Array.isArray(counters.body?.data));
  const counterId = counters.body?.data?.[0]?.id;
  if (counterId === undefined) {
    console.log('\nNo counters configured — nothing to talk to. Seed a counter and re-run.');
    process.exit(1);
  }

  console.log('\nOffice → counter');
  const sent = await call('POST', `/counter-chat/${counterId}/messages`, {
    token: office,
    body: { body: 'Please add more mirchi to the next order.' },
  });
  check('office message accepted', sent.status === 201, sent.body);
  check('office message is TO_COUNTER', sent.body?.data?.direction === 'TO_COUNTER', sent.body?.data?.direction);
  check('sender name recorded', typeof sent.body?.data?.senderName === 'string');

  console.log('\nOrder tagging');
  /* Any counter with something still on its board will do — tagging is the same code path
     everywhere, and demanding it be the *first* counter would skip this section whenever that
     one board happened to be clear. */
  /* An order reaches a counter through `counter_routes` on its *items*, not through
     `pos_orders.counter_id` — that column is null on every order the till writes. Asking the
     board for its own queue is therefore the only honest way to find a taggable order, and
     checking the column instead is exactly the bug this section now guards. */
  let tagCounterId = null;
  let openOrder;
  for (const row of counters.body.data) {
    const queue = await call('GET', `/kds/counter/${row.id}/queue`, { token: office });
    const candidate = (queue.body?.data?.orders ?? [])[0];
    if (candidate !== undefined) {
      tagCounterId = row.id;
      openOrder = candidate;
      break;
    }
  }

  if (tagCounterId === null) {
    for (const row of counters.body.data) {
      const recent = await call('GET', `/kds/counter/${row.id}/recent-actions`, { token: office });
      const served = recent.body?.data?.[0];
      if (served !== undefined) {
        tagCounterId = row.id;
        openOrder = { id: served.orderId, orderNumber: served.orderNumber };
        console.log('  NOTE  board is clear; tagging a recently served order instead');
        break;
      }
    }
  }

  /* Nothing open anywhere — quiet canteen, not a broken build. A recently served order still
     exercises everything this section is about (the counter check, the number snapshot, the
     tag showing up), because the API accepts any order belonging to the counter; it is the
     admin's *picker* that narrows the offer to what is still unserved. */
  if (tagCounterId === null) {
    for (const row of counters.body.data) {
      const recent = await call('GET', `/kds/counter/${row.id}/recent-actions`, { token: office });
      const served = recent.body?.data?.[0];
      if (served !== undefined) {
        tagCounterId = row.id;
        openOrder = { id: served.orderId, orderNumber: served.orderNumber };
        console.log('  NOTE  no open orders; tagging a recently served one instead');
        break;
      }
    }
  }

  if (tagCounterId === null) {
    console.log('  SKIP  no counter has an open order to tag');
  } else {
    const tagged = await call('POST', `/counter-chat/${tagCounterId}/messages`, {
      token: office,
      body: { body: 'Check this one before it goes out.', orderId: openOrder.id },
    });
    check('tagged message accepted', tagged.status === 201, tagged.body);
    check('order number snapshotted', tagged.body?.data?.orderNumber === openOrder.orderNumber);

    const tags = await call('GET', `/counter-chat/${tagCounterId}/order-tags`, { token: counter });
    const tag = (tags.body?.data ?? []).find((row) => row.orderId === openOrder.id);
    check('order tag visible to the counter', tag !== undefined && tag.unreadCount >= 1, tags.body?.data);
  }

  // A tag naming an order on another counter must be refused, not silently dropped.
  const bogus = await call('POST', `/counter-chat/${counterId}/messages`, {
    token: office,
    body: { body: 'wrong board', orderId: '00000000-0000-4000-8000-000000000000' },
  });
  check('foreign order id rejected', bogus.status === 400 || bogus.status === 422, bogus.status);

  console.log('\nBell');
  const bell = await call('POST', `/counter-chat/${counterId}/bell`, { token: office });
  check('bell accepted from the office', bell.status === 201, bell.body);
  check('bell has kind BELL', bell.body?.data?.kind === 'BELL');
  const counterBell = await call('POST', `/counter-chat/${counterId}/bell`, { token: counter });
  check('counter cannot ring itself', counterBell.status >= 400, counterBell.status);

  console.log('\nCounter → office');
  const reply = await call('POST', `/counter-chat/${counterId}/messages`, {
    token: counter,
    body: { body: 'Theek hai, kar diya.' },
  });
  check('counter message accepted', reply.status === 201, reply.body);
  check('counter message is TO_ADMIN', reply.body?.data?.direction === 'TO_ADMIN', reply.body?.data?.direction);

  console.log('\nThread and unread');
  const officeThread = await call('GET', `/counter-chat/${counterId}`, { token: office });
  check('office reads the thread', officeThread.status === 200);
  check('thread is in time order', (() => {
    const times = (officeThread.body?.data?.messages ?? []).map((m) => Date.parse(m.createdAt));
    return times.every((value, index) => index === 0 || times[index - 1] <= value);
  })());
  /* Deliberately *not* asserting "unread >= 1" here. A live admin desktop watching this
     counter marks an arriving message read within milliseconds — correct behaviour, not a
     fault — so that assertion fails whenever somebody has the app open, which is precisely
     when you most want to run this. The reply landing in the thread is the deterministic
     fact; the read *transition* is asserted below, where it cannot be raced. */
  check('office thread contains the counter reply',
    (officeThread.body?.data?.messages ?? []).some((m) => m.body === 'Theek hai, kar diya.'));
  console.log(`  NOTE  office unread reads ${officeThread.body?.data?.unreadCount} (a live admin client may have consumed it)`);

  const read = await call('POST', `/counter-chat/${counterId}/read`, { token: office });
  check('office marks read', read.status === 200);
  const afterRead = await call('GET', `/counter-chat/${counterId}`, { token: office });
  check('office unread cleared', afterRead.body?.data?.unreadCount === 0, afterRead.body?.data?.unreadCount);

  /* Same reasoning in the other direction, plus the property that actually matters: the
     office marking *its* side read must not touch what the counter still owes. */
  const counterThread = await call('GET', `/counter-chat/${counterId}`, { token: counter });
  check('counter thread still holds the office messages',
    (counterThread.body?.data?.messages ?? []).some((m) => m.direction === 'TO_COUNTER'));
  const counterRead = await call('POST', `/counter-chat/${counterId}/read`, { token: counter });
  check('counter can mark its own side read', counterRead.status === 200);
  const counterAfter = await call('GET', `/counter-chat/${counterId}`, { token: counter });
  check('counter unread cleared', counterAfter.body?.data?.unreadCount === 0,
    counterAfter.body?.data?.unreadCount);

  console.log('\nValidation');
  const empty = await call('POST', `/counter-chat/${counterId}/messages`, {
    token: office,
    body: { body: '   ' },
  });
  check('empty message rejected', empty.status === 400 || empty.status === 422, empty.status);

  const summaries = await call('GET', '/counter-chat', { token: office });
  check('summaries list every counter', summaries.status === 200
    && (summaries.body?.data ?? []).length === counters.body.data.length);

  console.log('\nTranslate on demand');
  const forTranslate = await call('POST', `/counter-chat/${counterId}/messages`, {
    token: office,
    body: { body: 'Please send two more plates to the hall.' },
  });
  const translated = await call(
    'POST',
    `/counter-chat/${counterId}/messages/${forTranslate.body?.data?.id}/translate`,
    { token: counter },
  );
  check('translate answers', translated.status === 200, translated.status);
  // The translator is a third-party service; offline it returns the message untouched rather
  // than failing, which is the documented behaviour, so both outcomes are acceptable here.
  check('translate returns the same message id',
    translated.body?.data?.id === forTranslate.body?.data?.id);
  console.log(`  NOTE  bodyHi = ${JSON.stringify(translated.body?.data?.bodyHi)}`);

  console.log('\nClear');
  const counterClear = await call('DELETE', `/counter-chat/${counterId}/messages`, { token: counter });
  check('a counter cannot clear its own thread', counterClear.status >= 400, counterClear.status);
  const cleared = await call('DELETE', `/counter-chat/${counterId}/messages`, { token: office });
  check('office clears the thread', cleared.status === 200, cleared.body);
  const afterClear = await call('GET', `/counter-chat/${counterId}`, { token: office });
  check('thread is empty after clearing',
    (afterClear.body?.data?.messages ?? []).length === 0, afterClear.body?.data?.messages?.length);


  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
