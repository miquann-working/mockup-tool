const db = require('./backend/src/db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t=>t.name).join(', '));
const geminiAccounts = db.prepare("SELECT id,email FROM gemini_accounts LIMIT 5").all();
console.log('Accounts:', JSON.stringify(geminiAccounts));
