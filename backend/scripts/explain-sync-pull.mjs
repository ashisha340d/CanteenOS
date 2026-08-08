/**
 * One-off diagnostic: EXPLAIN the sync pull hot-path query (orders.changedSince) against
 * whatever data is currently seeded, so an index decision is evidence-based rather than
 * speculative (Phase 7 performance pass). Not part of the smoke suite; run manually.
 *
 * Run with: node scripts/explain-sync-pull.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM orders');
console.log(`orders rows: ${total}`);

const [boardRows] = await connection.query('SELECT id FROM boards LIMIT 5');
const boardIds = boardRows.map((r) => r.id);
console.log(`sample board ids: ${boardIds.length}`);

const placeholders = boardIds.map(() => '?').join(', ');

console.log('\n--- EXPLAIN: orders.changedSince (cursor=0, the coldest/worst case) ---');
const [plan0] = await connection.query(
  `EXPLAIN SELECT id FROM orders WHERE sync_seq > ? AND board_id IN (${placeholders}) ORDER BY sync_seq ASC LIMIT ?`,
  [0, ...boardIds, 500],
);
console.table(plan0);

console.log('\n--- EXPLAIN: orders.changedSince (cursor near the current max, the common case) ---');
const [[{ maxSeq }]] = await connection.query('SELECT COALESCE(MAX(sync_seq), 0) AS maxSeq FROM orders');
const [planHot] = await connection.query(
  `EXPLAIN SELECT id FROM orders WHERE sync_seq > ? AND board_id IN (${placeholders}) ORDER BY sync_seq ASC LIMIT ?`,
  [Math.max(0, Number(maxSeq) - 10), ...boardIds, 500],
);
console.table(planHot);

console.log('\n--- EXPLAIN: order_items.itemsChangedSince equivalent shape ---');
const [planItems] = await connection.query(
  `EXPLAIN SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.sync_seq > ? AND o.board_id IN (${placeholders}) ORDER BY oi.sync_seq ASC LIMIT ?`,
  [0, ...boardIds, 500],
);
console.table(planItems);

await connection.end();
