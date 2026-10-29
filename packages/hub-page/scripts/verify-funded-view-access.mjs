/**
 * Read-only A01 integration check against an explicitly named non-production
 * Supabase branch. Never logs keys, passwords, JWTs or response records.
 * See docs/a01-private-financial-view-remediation.md for environment inputs.
 */
import assert from 'node:assert/strict';

const required = name => {
  const value = process.env[name];
  assert(value, `Missing ${name}`);
  return value;
};
const ref = required('FUNDED_SECURITY_PROJECT_REF');
assert.notEqual(ref, 'qmhmwkjmwcvlipotvkly', 'This check must not target production');
const url = new URL(required('FUNDED_SECURITY_SUPABASE_URL'));
assert.equal(url.protocol, 'https:');
assert.equal(url.hostname, `${ref}.supabase.co`, 'Project URL/ref mismatch');
assert.equal(url.pathname, '/');
assert(!url.username && !url.password && !url.search && !url.hash);
const publicKey = required('FUNDED_SECURITY_PUBLIC_KEY');
const serviceKey = required('FUNDED_SECURITY_SERVICE_KEY');
const targetMerchant = required('FUNDED_SECURITY_TARGET_MERCHANT_ID');
const expectedMinor = Number(required('FUNDED_SECURITY_EXPECTED_OUTSTANDING_MINOR'));
assert(Number.isSafeInteger(expectedMinor) && expectedMinor > 0, 'Use a positive synthetic payable so empty data cannot mask exposure');
const views = [
  'v_voucher_funding_allocation_budget', 'v_voucher_funding_allocation_availability',
  'v_voucher_funding_program_budget', 'v_voucher_payable_net_amounts',
  'v_unbatched_voucher_payables', 'v_partner_voucher_payable_balances',
  'v_partner_settlement_batches', 'v_open_voucher_reconciliation_incidents',
  'v_merchant_voucher_reimbursement_statement',
];

const checks = [];
async function request(path, key, token, body) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, url), {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}
async function login(prefix) {
  const result = await request('/auth/v1/token?grant_type=password', publicKey, null, {
    email: required(`${prefix}_EMAIL`), password: required(`${prefix}_PASSWORD`),
  });
  assert.equal(result.status, 200, `${prefix} synthetic sign-in failed`);
  assert(typeof result.data.access_token === 'string');
  return result.data.access_token;
}
const actors = [
  { name: 'anonymous', token: null },
  { name: 'other-merchant', token: await login('FUNDED_SECURITY_OTHER_MERCHANT') },
  { name: 'payable-owner-merchant', token: await login('FUNDED_SECURITY_OWNER_MERCHANT') },
];
for (const actor of actors) {
  for (const view of views) {
    const result = await request(`/rest/v1/${view}?select=*&limit=1`, publicKey, actor.token);
    assert([401, 403].includes(result.status), `${actor.name} can access ${view}, or denial is not explicit (HTTP ${result.status})`);
    assert.equal(result.data.code, '42501', `${view}: expected permission denial rather than an absent endpoint`);
    checks.push({ actor: actor.name, view, status: result.status, passed: true });
  }
  for (const name of ['merchant_voucher_reimbursement_statement', 'merchant_voucher_reimbursement_summary', 'merchant_voucher_reimbursement_page']) {
    const rpc = await request(`/rest/v1/rpc/${name}`, publicKey, actor.token, { p_merchant_id: targetMerchant });
    assert([401, 403].includes(rpc.status), `${actor.name} can call ${name}, or its denial is not explicit`);
    assert.equal(rpc.data.code, '42501', 'Expected permission denial rather than an absent function');
    checks.push({ actor: actor.name, rpc: name, status: rpc.status, passed: true });
  }
}
for (const view of views) {
  const result = await request(`/rest/v1/${view}?select=*&limit=1`, serviceKey);
  assert.equal(result.status, 200, `Server cannot read ${view}`);
  assert(Array.isArray(result.data));
  checks.push({ actor: 'service_role', view, status: result.status, passed: true });
}
const statement = await request('/rest/v1/rpc/merchant_voucher_reimbursement_page', serviceKey, null, { p_merchant_id: targetMerchant, p_limit: 50 });
assert.equal(statement.status, 200, 'Server statement page RPC failed');
assert(Array.isArray(statement.data) && statement.data.length > 0 && statement.data.length <= 50, 'Expected a bounded page with a genuine synthetic payable');
assert(statement.data.every(row => row.merchant_id === targetMerchant), 'Statement merchant scope escaped');
checks.push({ actor: 'service_role', rpc: 'merchant_voucher_reimbursement_page', status: 200, passed: true });
const summary = await request('/rest/v1/rpc/merchant_voucher_reimbursement_summary', serviceKey, null, { p_merchant_id: targetMerchant });
assert.equal(summary.status, 200, 'Server summary RPC failed');
assert.equal(Number(summary.data.outstandingMinor), expectedMinor, 'Full-ledger summary changed the synthetic payable');
checks.push({ actor: 'service_role', rpc: 'merchant_voucher_reimbursement_summary', status: 200, passed: true });
const legacy = await request('/rest/v1/rpc/merchant_voucher_reimbursement_statement', serviceKey, null, { p_merchant_id: targetMerchant });
assert.equal(legacy.data.code, 'P0001', 'Legacy unbounded statement must fail closed');
assert.equal(legacy.data.message, 'STATEMENT_CLIENT_UPGRADE_REQUIRED');
checks.push({ actor: 'service_role', rpc: 'legacy-statement-retired', status: legacy.status, passed: true });
console.log(JSON.stringify({ projectRef: ref, readOnly: true, passed: checks.length, checks }, null, 2));
