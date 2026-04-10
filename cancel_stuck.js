const db = require('./backend/src/db');
db.prepare("UPDATE jobs SET status = 'error', error = 'Cancelled: verification loop' WHERE id IN (349,350,351,352)").run();
console.log('Done: cancelled 4 stuck jobs (349-352)');
const r = db.prepare("SELECT id, status, retry_count FROM jobs WHERE id IN (349,350,351,352)").all();
console.table(r);
