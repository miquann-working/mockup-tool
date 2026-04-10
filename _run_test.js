const db = require('./backend/src/db');
const { enqueueJob } = require('./backend/src/services/jobRunner');

const pendingJobs = db.prepare("SELECT id FROM jobs WHERE status='pending' ORDER BY id ASC").all();
console.log(`Found ${pendingJobs.length} pending jobs`);
for (const j of pendingJobs) {
  enqueueJob(j.id);
  console.log(`Enqueued job ${j.id}`);
}
console.log('All pending jobs enqueued. Waiting for processing...');
// Keep process alive to let jobRunner work
setTimeout(() => {
  const results = db.prepare("SELECT id,status,error FROM jobs WHERE id IN (556,557,558,559)").all();
  console.log('\nFinal status:');
  results.forEach(j => console.log(`  Job ${j.id}: ${j.status}${j.error ? ' ('+j.error.substring(0,80)+')' : ''}`));
  process.exit(0);
}, 20 * 60 * 1000); // 20 min timeout
