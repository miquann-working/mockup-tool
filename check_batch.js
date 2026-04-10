const db = require('./backend/src/db');
const jobs = db.prepare(`
  SELECT j.id, j.batch_id, j.status, j.error, j.retry_count, j.created_at, j.updated_at, a.email 
  FROM jobs j LEFT JOIN gemini_accounts a ON j.account_id = a.id 
  ORDER BY j.id DESC LIMIT 12
`).all();
console.table(jobs);
