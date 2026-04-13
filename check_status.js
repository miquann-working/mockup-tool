const db = require('./backend/src/db');

console.log('=== VPS Nodes ===');
console.table(db.prepare('SELECT id,name,status,port FROM vps_nodes').all());

console.log('=== Accounts ===');
console.table(db.prepare('SELECT id,email,status,vps_id,rate_limited_until FROM gemini_accounts').all());

console.log('=== Pending Jobs ===');
console.table(db.prepare("SELECT id,status,user_id,account_id,retry_count FROM jobs WHERE status IN ('pending','processing') ORDER BY id").all());

console.log('=== Users ===');
console.table(db.prepare('SELECT id,username,vps_id FROM users').all());
