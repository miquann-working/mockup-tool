const db = require('./backend/src/db');
// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
db.prepare("UPDATE jobs SET status='pending', mockup_image=NULL, error=NULL, batch_id=NULL, retry_count=0, account_id=NULL WHERE id IN (556,557,558,559)").run();
// Find the actual account table
try { db.prepare("UPDATE gemini_accounts SET status='free' WHERE status='busy'").run(); console.log('Freed gemini_accounts'); } catch(e) {}
try { db.prepare("UPDATE gmail_accounts SET status='free' WHERE status='busy'").run(); } catch(e) {}
console.log('Reset done');
db.prepare('SELECT id,status FROM jobs WHERE id BETWEEN 556 AND 559').all().forEach(j => console.log(j.id, j.status));
