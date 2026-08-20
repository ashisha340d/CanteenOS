/**
 * Emits the role_capabilities INSERT for the purchase capabilities, derived from
 * shared/src/permissions rather than typed out by hand.
 *
 * Twenty-five capabilities across five roles is 125 chances to fat-finger a grant, and a
 * mistyped one is either a silent privilege escalation or a screen nobody can open. So the
 * migration body is generated from the same constant the application authorises against.
 */
import { Capability, ROLE_CAPABILITIES } from '@menuboard/shared';

/** Everything introduced for purchasing, inventory and vendor accounting. */
const PURCHASE_PREFIXES = ['product.', 'inventory.', 'stock.', 'purchase.'];

const purchaseCapabilities = Object.values(Capability)
  .filter((c) => PURCHASE_PREFIXES.some((p) => c.startsWith(p)))
  .sort();

const rows = [];
for (const [role, granted] of Object.entries(ROLE_CAPABILITIES)) {
  for (const capability of purchaseCapabilities) {
    if (granted.includes(capability)) rows.push({ role, capability });
  }
}
rows.sort((a, b) => a.role.localeCompare(b.role) || a.capability.localeCompare(b.capability));

// Everything goes to stdout, in order, so the output can be redirected straight into a
// migration without stderr interleaving itself into the middle of the statement.
const out = [];
out.push(`-- ${purchaseCapabilities.length} capabilities, ${rows.length} grants.`);
out.push('--');
out.push('-- Grants per role:');
for (const [role, granted] of Object.entries(ROLE_CAPABILITIES)) {
  const n = purchaseCapabilities.filter((c) => granted.includes(c)).length;
  out.push(`--   ${role.padEnd(12)} ${String(n).padStart(2)}/${purchaseCapabilities.length}`);
}
out.push('');
out.push('INSERT INTO `role_capabilities` (`role`, `capability`, `updated_by`, `updated_at`) VALUES');
out.push(rows.map((r) => `  ('${r.role}', '${r.capability}', NULL, UTC_TIMESTAMP(3))`).join(',\n'));
out.push('ON DUPLICATE KEY UPDATE `capability` = VALUES(`capability`);');

process.stdout.write(`${out.join('\n')}\n`);
