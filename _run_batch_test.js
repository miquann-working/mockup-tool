const db = require('./backend/src/db');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON = process.env.PYTHON_BIN || "python";
const SCRIPT = path.resolve(__dirname, "automation/gemini_worker.py");

// Get the 4 jobs and their prompts
const jobIds = [556, 557, 558, 559];
const jobDataList = [];
for (const id of jobIds) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  const prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(job.prompt_id);
  const group = db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(prompt.group_id);
  jobDataList.push({ job, prompt, group });
}

const imageStyle = jobDataList[0].group?.image_style || "Chân dung dịu nhẹ";
const imagePath = path.resolve(__dirname, "uploads", jobDataList[0].job.original_image);
const cookieDir = "cookies/adeliabergamaschi1980@gmail.com";

const jobsJson = jobDataList.map(({ job, prompt }) => ({
  promptText: prompt.content,
  outputPrefix: `mockup_${job.id}`,
}));

console.log(`Running batch of ${jobsJson.length} jobs on account #6`);
console.log(`Image: ${imagePath}`);
console.log(`Style: ${imageStyle}`);
console.log(`Cookie dir: ${cookieDir}`);
console.log('---');

const start = Date.now();
const child = spawn(PYTHON, [SCRIPT], {
  env: {
    ...process.env,
    COOKIE_DIR: cookieDir,
    IMAGE_PATH: imagePath,
    IMAGE_STYLE: imageStyle,
    SKIP_IMAGE_TOOL: "",
    JOBS_JSON: JSON.stringify(jobsJson),
  },
  cwd: __dirname,
});

child.stdout.on('data', d => {
  const lines = d.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    console.log(`[STDOUT] ${line}`);
  }
});
child.stderr.on('data', d => {
  process.stderr.write(d);
});
child.on('close', code => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Process exited with code ${code} in ${elapsed}s ===`);
  if (code === 0) {
    console.log('SUCCESS: All 4 jobs completed!');
  } else if (code === 2) {
    console.log('RATE_LIMITED');
  } else {
    console.log('FAILED');
  }
});
