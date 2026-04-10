const db = require('./backend/src/db');
const r = db.prepare(`
  SELECT j.id, j.batch_id, j.status, j.error, j.retry_count, j.updated_at, a.email 
  FROM jobs j LEFT JOIN gemini_accounts a ON j.account_id = a.id 
  WHERE j.batch_id = 'a2323c1d-ad00-477a-8956-99308a8120ef' 
  ORDER BY j.id
`).all();
r.forEach(j => console.log(JSON.stringify({
  id: j.id,
  status: j.status,
  retry: j.retry_count,
  updated: j.updated_at,
  email: j.email,
  err: (j.error || '').slice(-200)
})));
