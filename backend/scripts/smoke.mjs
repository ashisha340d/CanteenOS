/**
 * End-to-end smoke test against a running server.
 *
 * Exercises the whole Phase 2 surface: auth and refresh rotation, RBAC, the Android capability
 * boundary, order creation with items, thread, acknowledgement, sync push/pull, media upload and
 * signed download, reports and billing generation.
 *
 * Run with: node scripts/smoke.mjs
 */

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

function section(title) {
  console.log(`\n${title}`);
}

async function call(method, path, { token, body, clientType, raw } = {}) {
  const headers = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (clientType !== undefined) headers['X-Client-Type'] = clientType;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) return response;
  const text = await response.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = { parseError: text.slice(0, 200) };
  }
  return { status: response.status, body: json };
}

async function login(identifier, clientType) {
  const result = await call('POST', '/auth/login', {
    body: {
      identifier,
      password: PASSWORD,
      deviceId: `smoke-${identifier}-${clientType}`,
      deviceName: 'smoke test',
      clientType,
    },
  });
  if (result.status !== 200) {
    throw new Error(`login failed for ${identifier}: ${JSON.stringify(result.body)}`);
  }
  return result.body.data;
}

async function main() {
  section('Health');
  const health = await fetch(`${BASE}/health`);
  check('health returns 200', health.status === 200);

  /* ------------------------------------------------------------ auth */

  section('Authentication');
  const badLogin = await call('POST', '/auth/login', {
    body: {
      identifier: 'superadmin',
      password: 'wrong-password',
      deviceId: 'smoke-bad',
      clientType: 'ADMIN',
    },
  });
  check('wrong password is rejected 401', badLogin.status === 401, badLogin.body);
  check(
    'error code is INVALID_CREDENTIALS',
    badLogin.body?.error?.code === 'INVALID_CREDENTIALS',
    badLogin.body,
  );

  const adminSession = await login('admin', 'ADMIN');
  check('admin login returns tokens', typeof adminSession.tokens.accessToken === 'string');
  check(
    'admin must change seeded password',
    adminSession.user.mustChangePassword === true,
    adminSession.user,
  );
  const adminToken = adminSession.tokens.accessToken;

  // Admin Portal sign-in is restricted to the ADMIN role only — every other role is
  // rejected before a session is ever issued, regardless of otherwise-valid credentials.
  for (const [identifier, role] of [
    ['superadmin', 'SUPER_ADMIN'],
    ['manager', 'MANAGER'],
    ['user1', 'USER'],
  ]) {
    const rejected = await call('POST', '/auth/login', {
      body: {
        identifier,
        password: PASSWORD,
        deviceId: `smoke-${identifier}-admin-portal-block`,
        clientType: 'ADMIN',
      },
    });
    check(`${role} cannot sign in to the Admin Portal (403)`, rejected.status === 403, rejected.body);
    check(
      `${role} Admin Portal rejection reports ADMIN_ROLE_REQUIRED`,
      rejected.body?.error?.code === 'ADMIN_ROLE_REQUIRED',
      rejected.body,
    );
  }

  const androidSession = await login('user1', 'ANDROID');
  const androidToken = androidSession.tokens.accessToken;
  check(
    'android capabilities exclude billing.generate',
    !androidSession.capabilities.includes('billing.generate'),
    androidSession.capabilities,
  );
  check(
    'android capabilities exclude master.write',
    !androidSession.capabilities.includes('master.write'),
  );
  check('android capabilities include sync.use', androidSession.capabilities.includes('sync.use'));

  const noToken = await call('GET', '/boards');
  check('unauthenticated request is 401', noToken.status === 401);

  const badToken = await call('GET', '/boards', { token: 'not-a-jwt' });
  check('malformed token is 401', badToken.status === 401);

  section('Refresh token rotation');
  const firstRefresh = await call('POST', '/auth/refresh', {
    body: {
      refreshToken: adminSession.tokens.refreshToken,
      deviceId: 'smoke-admin-ADMIN',
    },
  });
  check('refresh succeeds', firstRefresh.status === 200, firstRefresh.body);

  const replay = await call('POST', '/auth/refresh', {
    body: {
      refreshToken: adminSession.tokens.refreshToken,
      deviceId: 'smoke-admin-ADMIN',
    },
  });
  check('reused refresh token is rejected', replay.status === 401, replay.body);
  check(
    'reuse reports REFRESH_REUSED',
    replay.body?.error?.code === 'REFRESH_REUSED',
    replay.body,
  );

  // The chain was revoked by the reuse detection, so sign in again for the rest of the run.
  const admin2 = await login('admin', 'ADMIN');
  const admin = admin2.tokens.accessToken;

  /* --------------------------------------------------------- android boundary */

  section('Android capability boundary');
  const androidBilling = await call('POST', '/admin/billing/generate', {
    token: androidToken,
    body: { periodFrom: '2026-01-01', periodTo: '2026-12-31' },
  });
  check('android blocked from billing', androidBilling.status === 403, androidBilling.body);
  check(
    'billing block reports CLIENT_NOT_PERMITTED',
    androidBilling.body?.error?.code === 'CLIENT_NOT_PERMITTED',
    androidBilling.body,
  );

  const androidReports = await call('GET', '/admin/reports/ORDERS_BY_BOARD?dateFrom=2026-01-01&dateTo=2026-12-31', {
    token: androidToken,
  });
  check('android blocked from reports', androidReports.status === 403);

  const androidUsers = await call('POST', '/users', {
    token: androidToken,
    body: {
      name: 'Should Not Exist',
      username: 'shouldnotexist',
      password: 'Password123',
      role: 'USER',
    },
  });
  check('android blocked from creating users', androidUsers.status === 403);

  const androidMaster = await call('POST', '/menu-categories', {
    token: androidToken,
    body: { name: 'Android Should Not Write' },
  });
  check('android blocked from master write', androidMaster.status === 403);

  const androidMasterRead = await call('GET', '/menu-items?pageSize=5', { token: androidToken });
  check('android can read menu items', androidMasterRead.status === 200, androidMasterRead.body);
  check(
    'menu items were seeded',
    Array.isArray(androidMasterRead.body?.data) && androidMasterRead.body.data.length > 0,
  );

  /* ------------------------------------------------------------ RBAC */

  section('Role-based access');
  // user2 is a plain USER and can no longer sign in with clientType ADMIN (see the Admin
  // Portal role gate above), so the capability check below is exercised over an ANDROID
  // session instead — USER_WRITE is denied by role regardless of client type.
  const userSession = await login('user2', 'ANDROID');
  const userToken = userSession.tokens.accessToken;
  const userListsUsers = await call('POST', '/users', {
    token: userToken,
    body: { name: 'Nope', username: 'nope1', password: 'Password123', role: 'USER' },
  });
  check('plain USER cannot create users', userListsUsers.status === 403, userListsUsers.body);

  const superAdminByAdmin = await call('POST', '/users', {
    token: admin,
    body: {
      name: 'Escalation Attempt',
      username: `escalate${Date.now()}`,
      password: 'Password123',
      role: 'SUPER_ADMIN',
    },
  });
  check(
    'ADMIN cannot mint a SUPER_ADMIN',
    superAdminByAdmin.status === 403,
    superAdminByAdmin.body,
  );

  /* ----------------------------------------------------------- boards */

  section('Boards');
  const boards = await call('GET', '/boards?withCounts=true', { token: admin });
  check('board list returns 200', boards.status === 200, boards.body);
  check('seeded boards present', boards.body?.data?.length >= 5, boards.body?.meta);
  const board = boards.body.data.find((b) => b.name === 'Kitchen') ?? boards.body.data[0];
  check('board carries members', Array.isArray(board.members) && board.members.length > 0);

  /* ----------------------------------------------------------- orders */

  section('Orders');
  const activities = await call('GET', '/activity-types', { token: admin });
  const lunch = activities.body.data.find((a) => a.name === 'Lunch');
  check('system activity types seeded', lunch !== undefined && lunch.isSystem === true);

  const items = await call('GET', '/menu-items?pageSize=3', { token: admin });
  const menuItems = items.body.data;

  const orderId = randomUUID();
  const createOrder = await call('POST', '/orders', {
    token: androidToken,
    body: {
      id: orderId,
      boardId: board.id,
      activityTypeId: lunch.id,
      venue: 'Main Dining Hall',
      pax: 250,
      requiredDate: '2026-08-06',
      requiredTime: '12:30',
      priority: 'HIGH',
      items: menuItems.map((item, index) => ({
        menuItemId: item.id,
        quantity: 10 + index,
        notes: index === 0 ? 'Less spice' : null,
      })),
    },
  });
  check('order created', createOrder.status === 201, createOrder.body);
  const order = createOrder.body?.data;
  check(
    'order number matches offline-safe format',
    /^ORD-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/.test(order?.orderNumber ?? ''),
    order?.orderNumber,
  );
  check('order starts PENDING', order?.status === 'PENDING');
  check('order items persisted', order?.items?.length === menuItems.length);
  check('order unit inherited from menu master', order?.items?.[0]?.unit === menuItems[0].unit);

  const missingActivity = await call('POST', '/orders', {
    token: androidToken,
    body: {
      boardId: board.id,
      venue: 'No Activity',
      pax: 10,
      requiredDate: '2026-08-06',
      requiredTime: '10:00',
      items: [{ menuItemId: menuItems[0].id, quantity: 1 }],
    },
  });
  check(
    'order without activity is rejected 400',
    missingActivity.status === 400,
    missingActivity.body,
  );

  const badTransition = await call('POST', `/orders/${orderId}/status`, {
    token: androidToken,
    body: { status: 'COMPLETED' },
  });
  check(
    'PENDING cannot jump straight to COMPLETED',
    badTransition.status === 409,
    badTransition.body,
  );
  check(
    'transition error is INVALID_STATUS_TRANSITION',
    badTransition.body?.error?.code === 'INVALID_STATUS_TRANSITION',
  );

  /* ------------------------------------------------- acknowledgement */

  section('Acknowledgements');
  const ack = await call('POST', `/orders/${orderId}/acknowledgements`, {
    token: androidToken,
    body: { note: 'Received, starting prep' },
  });
  check('acknowledgement created', ack.status === 201, ack.body);

  const ackAgain = await call('POST', `/orders/${orderId}/acknowledgements`, {
    token: androidToken,
    body: { note: 'duplicate' },
  });
  check('acknowledging twice is idempotent', ackAgain.status === 201, ackAgain.body);

  const afterAck = await call('GET', `/orders/${orderId}`, { token: androidToken });
  check(
    'first acknowledgement advanced status to ACKNOWLEDGED',
    afterAck.body?.data?.status === 'ACKNOWLEDGED',
    afterAck.body?.data?.status,
  );
  check(
    'pending acknowledgement list computed',
    Array.isArray(afterAck.body?.data?.pendingAcknowledgementUserIds),
  );

  /* -------------------------------------------------------- thread */

  section('Thread and history');
  const message = await call('POST', `/orders/${orderId}/thread`, {
    token: androidToken,
    body: { body: 'Please keep two trays aside for the kitchen team.' },
  });
  check('thread message posted', message.status === 201, message.body);

  const emptyMessage = await call('POST', `/orders/${orderId}/thread`, {
    token: androidToken,
    body: { body: '' },
  });
  check('empty message rejected', emptyMessage.status === 400, emptyMessage.body);

  const thread = await call('GET', `/orders/${orderId}/thread`, { token: androidToken });
  check('thread readable', thread.status === 200);
  const systemMessages = (thread.body?.data ?? []).filter((m) => m.messageType === 'SYSTEM');
  check('history materialised as system messages', systemMessages.length >= 2, systemMessages.length);
  check(
    'status change recorded in history',
    systemMessages.some((m) => m.systemEvent === 'ORDER_STATUS_CHANGED'),
  );
  check(
    'creation recorded in history',
    systemMessages.some((m) => m.systemEvent === 'ORDER_CREATED'),
  );

  /* --------------------------------------------------- notifications */

  section('Notifications');
  const managerSession = await login('manager', 'ANDROID');
  const notifications = await call('GET', '/notifications', {
    token: managerSession.tokens.accessToken,
  });
  check('notifications readable', notifications.status === 200, notifications.body);
  check(
    'manager was notified of the new order',
    (notifications.body?.data ?? []).some((n) => n.type === 'NEW_ORDER'),
    notifications.body?.data?.map((n) => n.type),
  );

  /* ----------------------------------------------------- push dispatch */

  section('Push notification dispatch');
  const fakePushToken = `ExponentPushToken[smoke-${randomUUID().slice(0, 8)}]`;
  const pushTokenRegistration = await call('POST', '/auth/push-token', {
    token: androidToken,
    body: { deviceId: 'smoke-user1-ANDROID', pushToken: fakePushToken },
  });
  check('push token registration returns 204', pushTokenRegistration.status === 204);

  const pushNotificationThread = await call('POST', `/orders/${orderId}/thread`, {
    token: userToken,
    body: { body: 'Mentioning user1 for push dispatch', mentionedUserIds: [androidSession.user.id] },
  });
  check(
    'notification creation still succeeds while push dispatch runs',
    pushNotificationThread.status === 201,
    pushNotificationThread.body,
  );

  /* --------------------------------------------------------- media */

  section('Media upload and signed download');
  // 1x1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');

  const uploadResponse = await fetch(
    `${API}/attachments/upload?ownerType=ORDER&ownerId=${orderId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${androidToken}` }, body: form },
  );
  const uploadBody = await uploadResponse.json();
  check('image upload succeeds', uploadResponse.status === 201, uploadBody);
  check('upload returns a signed url', typeof uploadBody?.data?.url === 'string');
  check('checksum recorded', typeof uploadBody?.data?.attachment?.checksum === 'string');

  if (uploadBody?.data?.url) {
    const download = await fetch(uploadBody.data.url);
    const bytes = Buffer.from(await download.arrayBuffer());
    check('signed url serves the file', download.status === 200);
    check('bytes round-trip intact', bytes.length === png.length, {
      got: bytes.length,
      expected: png.length,
    });

    const tampered = uploadBody.data.url.replace(/sig=[^&]+/, 'sig=tampered');
    const tamperedResponse = await fetch(tampered);
    check('tampered signature refused', tamperedResponse.status === 403);
  }

  const badUpload = new FormData();
  badUpload.append('file', new Blob([Buffer.from('#!/bin/sh')], { type: 'application/x-sh' }), 'x.sh');
  const badUploadResponse = await fetch(`${API}/attachments/upload?ownerType=ORDER`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${androidToken}` },
    body: badUpload,
  });
  check('disallowed mime type refused', badUploadResponse.status === 415, badUploadResponse.status);

  /* -------------------------------------------- attachment deletion */

  section('Attachment delete authorization (ATTACHMENT_DELETE_ANY)');
  // Regression coverage for the Phase 3/API.md-flagged gap: a plain MEMBER must not be able to
  // delete another member's attachment. Per BOARD_ROLE_CAPABILITIES (shared/src/permissions,
  // the single source of truth), ATTACHMENT_DELETE_ANY is granted per-board to OWNER only — a
  // MANAGER holds ATTACHMENT_UPLOAD but not delete-any — or globally to SUPER_ADMIN/ADMIN.
  const otherMemberSession = await login('user2', 'ANDROID');
  const otherMemberToken = otherMemberSession.tokens.accessToken;
  const uploadedAttachmentId = uploadBody?.data?.attachment?.id;

  if (uploadedAttachmentId) {
    const memberDeleteAttempt = await call('DELETE', `/attachments/${uploadedAttachmentId}`, {
      token: otherMemberToken,
    });
    check(
      'a plain MEMBER cannot delete another member\'s attachment (403)',
      memberDeleteAttempt.status === 403,
      memberDeleteAttempt.body,
    );

    const managerDeleteAttempt = await call('DELETE', `/attachments/${uploadedAttachmentId}`, {
      token: managerSession.tokens.accessToken,
    });
    check(
      'a board MANAGER (no ATTACHMENT_DELETE_ANY) also cannot delete another member\'s attachment (403)',
      managerDeleteAttempt.status === 403,
      managerDeleteAttempt.body,
    );

    const adminDeleteAttempt = await call('DELETE', `/attachments/${uploadedAttachmentId}`, {
      token: adminToken,
    });
    check(
      'a global ADMIN (ATTACHMENT_DELETE_ANY granted globally) can delete another member\'s attachment (204)',
      adminDeleteAttempt.status === 204,
      adminDeleteAttempt.body,
    );

    const secondDeleteAttempt = await call('DELETE', `/attachments/${uploadedAttachmentId}`, {
      token: adminToken,
    });
    check(
      'deleting an already-deleted attachment returns 404, not a silent success',
      secondDeleteAttempt.status === 404,
      secondDeleteAttempt.body,
    );
  } else {
    check('a plain MEMBER cannot delete another member\'s attachment (403)', false, 'no attachment id from upload');
    check('a board MANAGER (no ATTACHMENT_DELETE_ANY) also cannot delete another member\'s attachment (403)', false, 'no attachment id from upload');
    check('a global ADMIN (ATTACHMENT_DELETE_ANY granted globally) can delete another member\'s attachment (204)', false, 'no attachment id from upload');
    check('deleting an already-deleted attachment returns 404, not a silent success', false, 'no attachment id from upload');
  }

  // The uploader may always remove their own attachment, regardless of board role.
  const selfUploadForm = new FormData();
  selfUploadForm.append('file', new Blob([png], { type: 'image/png' }), 'self.png');
  const selfUploadResponse = await fetch(
    `${API}/attachments/upload?ownerType=ORDER&ownerId=${orderId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${androidToken}` }, body: selfUploadForm },
  );
  const selfUploadBody = await selfUploadResponse.json();
  const selfAttachmentId = selfUploadBody?.data?.attachment?.id;
  if (selfAttachmentId) {
    const selfDelete = await call('DELETE', `/attachments/${selfAttachmentId}`, {
      token: androidToken,
    });
    check('the uploader can always delete their own attachment (204)', selfDelete.status === 204, selfDelete.body);
  } else {
    check('the uploader can always delete their own attachment (204)', false, 'no attachment id from upload');
  }

  /* ---------------------------------------------------------- sync */

  section('Offline sync');
  const status = await call('GET', '/sync/status', { token: androidToken });
  check('sync status returns a cursor', typeof status.body?.data?.cursor === 'number', status.body);

  const pull = await call('POST', '/sync/pull', {
    token: androidToken,
    body: { deviceId: 'smoke-user1-ANDROID', cursor: 0, limit: 500 },
  });
  check('sync pull returns 200', pull.status === 200, pull.body);
  const changes = pull.body?.data?.changes;
  check('pull includes boards', (changes?.boards ?? []).length > 0);
  check('pull includes menu items', (changes?.menu_items ?? []).length > 0);
  check('pull includes the new order', (changes?.orders ?? []).some((o) => o.id === orderId));
  check('pull includes order items', (changes?.order_items ?? []).length > 0);
  check('pull includes thread messages', (changes?.thread_messages ?? []).length > 0);
  check('pull includes acknowledgements', (changes?.acknowledgements ?? []).length > 0);
  check('pull cursor advanced past 0', pull.body?.data?.cursor > 0);

  const offlineOrderId = randomUUID();
  const clientOpId = randomUUID();
  const pushBody = {
    deviceId: 'smoke-user1-ANDROID',
    items: [
      {
        clientOpId,
        entity: 'orders',
        entityId: offlineOrderId,
        op: 'UPSERT',
        clientTimestamp: new Date().toISOString(),
        payload: {
          boardId: board.id,
          customActivity: 'Offline created activity',
          venue: 'Created While Offline',
          pax: 40,
          requiredDate: '2026-08-07',
          requiredTime: '09:00',
          priority: 'NORMAL',
          items: [{ menuItemId: menuItems[0].id, quantity: 4 }],
        },
      },
    ],
  };

  const push = await call('POST', '/sync/push', { token: androidToken, body: pushBody });
  check('sync push returns 200', push.status === 200, push.body);
  check(
    'offline order applied',
    push.body?.data?.results?.[0]?.status === 'APPLIED',
    push.body?.data?.results,
  );

  const replayPush = await call('POST', '/sync/push', { token: androidToken, body: pushBody });
  const replayStatus = replayPush.body?.data?.results?.[0]?.status;
  check(
    'replayed push does not duplicate (APPLIED|DUPLICATE|SUPERSEDED)',
    ['APPLIED', 'DUPLICATE', 'SUPERSEDED'].includes(replayStatus),
    replayStatus,
  );

  const pushMaster = await call('POST', '/sync/push', {
    token: androidToken,
    body: {
      deviceId: 'smoke-user1-ANDROID',
      items: [
        {
          clientOpId: randomUUID(),
          entity: 'menu_items',
          entityId: randomUUID(),
          op: 'UPSERT',
          clientTimestamp: new Date().toISOString(),
          payload: { name: 'Device should not create this' },
        },
      ],
    },
  });
  check('pushing master data is rejected by validation', pushMaster.status === 400, pushMaster.body);

  /* ------------------------------------------------ complete the order */

  section('Order completion');
  const wip = await call('POST', `/orders/${orderId}/status`, {
    token: androidToken,
    body: { status: 'WORK_IN_PROGRESS' },
  });
  check('ACKNOWLEDGED -> WORK_IN_PROGRESS allowed', wip.status === 200, wip.body);

  const complete = await call('POST', `/orders/${orderId}/status`, {
    token: androidToken,
    body: { status: 'COMPLETED', note: 'Served on time' },
  });
  check('WORK_IN_PROGRESS -> COMPLETED allowed', complete.status === 200, complete.body);
  check('completedAt recorded', complete.body?.data?.completedAt !== null);

  const editCompleted = await call('PATCH', `/orders/${orderId}`, {
    token: androidToken,
    body: { pax: 999 },
  });
  check('completed order cannot be edited', editCompleted.status === 409, editCompleted.body);

  /* ------------------------------------------------------- admin surface */

  section('Admin: dashboard, reports, billing, audit, settings');
  const dashboard = await call('GET', '/admin/dashboard', { token: admin });
  check('dashboard returns 200', dashboard.status === 200, dashboard.body);
  check('dashboard counts boards', dashboard.body?.data?.boards?.total >= 5);

  const permissions = await call('GET', '/admin/permissions', { token: admin });
  check('permission matrix exposed', permissions.status === 200);
  check(
    'matrix marks billing.generate as android-forbidden',
    (permissions.body?.data?.androidForbiddenCapabilities ?? []).includes('billing.generate'),
  );

  for (const kind of [
    'ORDERS_BY_BOARD',
    'ORDERS_BY_DATE',
    'ORDERS_BY_USER',
    'COMPLETED_ORDERS',
    'PENDING_ORDERS',
    'ACTIVITY_SUMMARY',
    'BILLING_EXPORT_HISTORY',
  ]) {
    const report = await call(
      'GET',
      `/admin/reports/${kind}?dateFrom=2026-01-01&dateTo=2026-12-31`,
      { token: admin },
    );
    check(`report ${kind} returns 200`, report.status === 200, report.body);
  }

  const emptyBilling = await call('POST', '/admin/billing/generate', {
    token: admin,
    body: { periodFrom: '2020-01-01', periodTo: '2020-01-31' },
  });
  check(
    'billing with no completed orders is refused 409',
    emptyBilling.status === 409,
    emptyBilling.body,
  );

  const billing = await call('POST', '/admin/billing/generate', {
    token: admin,
    body: { boardId: board.id, periodFrom: '2026-08-01', periodTo: '2026-08-31', notes: 'Smoke run' },
  });
  check('billing generated', billing.status === 201, billing.body);
  // Asserted as >= 1 rather than == 1: the version counter is per board and period, so a repeated
  // run of this script against the same database legitimately starts higher.
  check('billing version assigned', billing.body?.data?.billingVersion >= 1);
  check('billing counts the completed order', billing.body?.data?.totalOrders >= 1);
  check('billing has a checksum', typeof billing.body?.data?.checksum === 'string');

  const regenerate = await call('POST', '/admin/billing/generate', {
    token: admin,
    body: { boardId: board.id, periodFrom: '2026-08-01', periodTo: '2026-08-31' },
  });
  check(
    'regenerating the same period bumps the version by exactly one',
    regenerate.body?.data?.billingVersion === billing.body?.data?.billingVersion + 1,
    { first: billing.body?.data?.billingVersion, second: regenerate.body?.data?.billingVersion },
  );
  check(
    'regeneration does not replace the earlier snapshot',
    regenerate.body?.data?.id !== billing.body?.data?.id,
  );

  const snapshot = await call('GET', `/admin/billing/${billing.body.data.id}/snapshot`, {
    token: admin,
  });
  check('snapshot retrievable', snapshot.status === 200, snapshot.body);
  check('snapshot contains order lines', (snapshot.body?.data?.orders ?? []).length >= 1);
  check(
    'snapshot orders carry items',
    (snapshot.body?.data?.orders?.[0]?.items ?? []).length >= 1,
  );

  const audit = await call('GET', '/admin/audit?pageSize=50', { token: admin });
  check('audit log readable', audit.status === 200, audit.body);
  const actions = (audit.body?.data ?? []).map((a) => a.action);
  check('login audited', actions.includes('auth.login'));
  check('order creation audited', actions.includes('order.created'));
  check('billing generation audited', actions.includes('billing.generated'));

  const settings = await call('GET', '/admin/settings', { token: admin });
  check('settings readable', settings.status === 200, settings.body);
  check('settings expose defaults', (settings.body?.data ?? []).length > 0);

  const validSetting = await call('PUT', '/admin/settings/organisation.name', {
    token: admin,
    body: { value: 'Smoke Test Org' },
  });
  check('valid setting accepted', validSetting.status === 200, validSetting.body);

  const invalidSetting = await call('PUT', '/admin/settings/sync.pull_limit', {
    token: admin,
    body: { value: 'not-a-number' },
  });
  check('invalid setting value rejected', invalidSetting.status === 400, invalidSetting.body);

  const unknownSetting = await call('PUT', '/admin/settings/made.up.key', {
    token: admin,
    body: { value: 1 },
  });
  check('unknown setting key rejected 404', unknownSetting.status === 404, unknownSetting.body);

  /* ------------------------------------------------------ validation */

  section('Validation hardening');
  const unknownKey = await call('POST', '/menu-categories', {
    token: admin,
    body: { name: 'Strict Test', unexpectedField: 'should be rejected' },
  });
  check('unknown body keys rejected', unknownKey.status === 400, unknownKey.body);

  const badUuid = await call('GET', '/orders/not-a-uuid', { token: admin });
  check('non-uuid path param rejected', badUuid.status === 400, badUuid.body);

  const badDate = await call('POST', '/orders', {
    token: androidToken,
    body: {
      boardId: board.id,
      customActivity: 'Bad date',
      venue: 'Venue',
      pax: 1,
      requiredDate: '2026-02-30',
      requiredTime: '10:00',
      items: [{ menuItemId: menuItems[0].id, quantity: 1 }],
    },
  });
  check('impossible calendar date rejected', badDate.status === 400, badDate.body);

  const weakPassword = await call('POST', '/users', {
    token: admin,
    body: {
      name: 'Weak',
      username: `weak${Date.now()}`,
      password: 'password',
      role: 'USER',
    },
  });
  check('password without a digit rejected', weakPassword.status === 400, weakPassword.body);

  /* -------------------------------------------------------- summary */

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  console.log('-'.repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exit(1);
});
