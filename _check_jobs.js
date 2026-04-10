const db = require('./backend/src/db');
const counts = db.prepare("SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status").all();
console.log("Job counts:", JSON.stringify(counts));
const recent = db.prepare("SELECT id, status, error FROM jobs WHERE id >= 528 ORDER BY id").all();
console.log("Recent jobs:", JSON.stringify(recent.map(j => ({id:j.id, status:j.status, err: j.error ? j.error.substring(0,50) : null})), null, 2));
