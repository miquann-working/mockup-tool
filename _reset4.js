const db = require('./backend/src/db');
db.prepare("UPDATE jobs SET status='pending', mockup_image=NULL, error=NULL, batch_id=NULL, retry_count=0, account_id=NULL WHERE id IN (556,557,558,559)").run();
console.log('Reset jobs 556-559 to pending');
console.log(JSON.stringify(db.prepare('SELECT id,status,prompt_id FROM jobs WHERE id IN (556,557,558,559)').all()));
