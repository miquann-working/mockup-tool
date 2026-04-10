const db = require('./backend/src/db');
const path = require('path');

// Get job details
const jobs = db.prepare("SELECT * FROM jobs WHERE id IN (556,557,558,559) ORDER BY id").all();
for (const j of jobs) {
  const prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(j.prompt_id);
  const group = prompt ? db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(prompt.group_id) : null;
  console.log(`Job ${j.id}: prompt_id=${j.prompt_id}, image=${j.original_image}`);
  console.log(`  Prompt: ${(prompt?.content||'').substring(0, 80)}...`);
  console.log(`  Style: ${group?.image_style || 'N/A'}`);
  console.log(`  Mode: ${prompt?.mode || 'N/A'}`);
}

// Get account with cookie dir
const accts = db.prepare("SELECT * FROM gemini_accounts WHERE status='free' ORDER BY last_used_at ASC").all();
for (const a of accts) {
  console.log(`\nAccount #${a.id}: ${a.email}, cookie_dir=${a.cookie_dir}, status=${a.status}`);
}
