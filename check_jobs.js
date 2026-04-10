const db = require('./backend/src/db');
const jobs = db.prepare("SELECT id, retry_count, status, batch_id FROM jobs WHERE status != 'done' ORDER BY id DESC LIMIT 8").all();
console.table(jobs);
