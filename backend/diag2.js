const db = require('./src/db');

console.log('=== Tables ===');
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());

console.log('\n=== Job 660 full ===');
console.log(db.prepare('SELECT * FROM jobs WHERE id=660').get());

console.log('\n=== Accounts assigned to VPS-Quan (vps_id=9) ===');
console.log(db.prepare('SELECT a.* FROM gemini_accounts a WHERE a.vps_id=9').all());

console.log('\n=== All accounts with VPS info ===');
console.log(db.prepare('SELECT a.id, a.email, a.status, a.vps_id, v.name as vps_name, v.status as vps_status FROM gemini_accounts a LEFT JOIN vps_nodes v ON a.vps_id=v.id').all());

console.log('\n=== Jobs still processing for >1 hour ===');
console.log(db.prepare("SELECT id, user_id, status, account_id, batch_id, retry_count, created_at, updated_at FROM jobs WHERE status='processing' AND updated_at < datetime('now', '-1 hour')").all());

console.log('\n=== pickAccount logic check for user trade (id=6, vps_id=9) ===');
// The pickAccount query: accounts where vps_id matches user's vps_id AND status='free'
const tradeUser = db.prepare('SELECT * FROM users WHERE id=6').get();
console.log('Trade user:', tradeUser);
const freeAccountsForTrade = db.prepare("SELECT * FROM gemini_accounts WHERE vps_id=? AND status='free' AND (rate_limited_until IS NULL OR rate_limited_until < datetime('now'))").all(tradeUser.vps_id);
console.log('Free accounts for trade:', freeAccountsForTrade);
