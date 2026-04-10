const db = require('./backend/src/db');
db.prepare("UPDATE jobs SET status='error', error='Server restarted - batch stuck' WHERE id=371 AND status='processing'").run();
console.log('Job 371:', db.prepare('SELECT id,status FROM jobs WHERE id=371').get());
