const db = require('./src/db');

console.log("=== Jobs by status ===");
console.log(db.prepare("SELECT count(*) as c, status FROM jobs GROUP BY status").all());

console.log("\n=== Pending/Processing jobs ===");
const stuck = db.prepare("SELECT id,user_id,status,account_id,batch_id,error,retry_count,created_at,updated_at FROM jobs WHERE status IN ('pending','processing') ORDER BY id").all();
console.log(JSON.stringify(stuck, null, 2));

console.log("\n=== Accounts ===");
console.log(db.prepare("SELECT id,email,status,vps_id,rate_limited_until FROM gemini_accounts").all());

console.log("\n=== VPS ===");
console.log(db.prepare("SELECT id,name,host,port,status FROM vps_nodes").all());

console.log("\n=== Backend running? ===");
const http = require('http');
http.get('http://localhost:4000/api/health', (res) => {
  console.log("Backend: UP (status " + res.statusCode + ")");
}).on('error', () => { console.log("Backend: DOWN"); });
