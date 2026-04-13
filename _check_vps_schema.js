const db = require('./backend/src/db');
console.log('vps_nodes columns:', db.prepare("PRAGMA table_info(vps_nodes)").all().map(c=>c.name).join(', '));
console.log('users vps_id:', db.prepare("PRAGMA table_info(users)").all().find(c=>c.name==='vps_id'));
console.log('accounts vps_id:', db.prepare("PRAGMA table_info(gemini_accounts)").all().find(c=>c.name==='vps_id'));
// Check existing data is intact
const users = db.prepare("SELECT id, username, role FROM users").all();
console.log('Users:', users);
const accounts = db.prepare("SELECT id, email, status FROM gemini_accounts").all();
console.log('Accounts:', accounts);
