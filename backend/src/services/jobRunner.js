const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const db = require("../db");

const PYTHON = process.env.PYTHON_BIN || "python";
const SCRIPT = path.resolve(__dirname, "../../../automation/gemini_worker.py");
const COOLDOWN_MS = 2_000; // 2s cooldown after each batch finishes
const RETRY_DELAY_SEC = 8; // seconds delay before retrying entire batch
const MAX_RETRIES = 5; // single-job retry limit only
const MAX_BATCH_RETRIES = 3; // max times to retry entire batch before giving up
const RETRY_DELAYS = [5, 10, 7, 8, 5]; // single-job retry delays
const BATCH_TIMEOUT_MS = 15 * 60 * 1000; // 15 min timeout for entire batch Python process

// VPS dispatch constants
const OUTPUTS_DIR = path.resolve(__dirname, "../../../outputs");
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const VPS_CALLBACK_URL = `${CALLBACK_BASE_URL}/api/vps/job-callback`;

// Track how many pending retries exist per batch so we don't release account too early
// Map<batchKey, number>
const pendingRetries = new Map();

// ── Helpers ─────────────────────────────────────────────────

function pickAccount(userId) {
  // Find user's VPS assignment
  let vpsId = null;
  if (userId) {
    const user = db.prepare("SELECT vps_id FROM users WHERE id = ?").get(userId);
    vpsId = user?.vps_id;
  }

  if (vpsId) {
    // Pick free account on user's VPS
    return db
      .prepare(
        `SELECT * FROM gemini_accounts
         WHERE status = 'free'
           AND vps_id = ?
           AND (rate_limited_until IS NULL OR rate_limited_until < datetime('now'))
         ORDER BY last_used_at ASC LIMIT 1`
      )
      .get(vpsId);
  }

  // No VPS assignment — pick local account (vps_id IS NULL)
  return db
    .prepare(
      `SELECT * FROM gemini_accounts
       WHERE status = 'free'
         AND vps_id IS NULL
         AND (rate_limited_until IS NULL OR rate_limited_until < datetime('now'))
       ORDER BY last_used_at ASC LIMIT 1`
    )
    .get();
}

function setAccountStatus(accountId, status) {
  db.prepare(
    "UPDATE gemini_accounts SET status = ?, last_used_at = datetime('now') WHERE id = ?"
  ).run(status, accountId);
}

function scheduleCooldown(accountId) {
  setAccountStatus(accountId, "cooldown");
  setTimeout(() => {
    setAccountStatus(accountId, "free");
    // After freeing, check if any batches are waiting for an account
    scheduleWaiting();
  }, COOLDOWN_MS);
}

function markAccountRateLimited(accountId) {
  // Mark account as rate-limited for 24 hours
  db.prepare(
    "UPDATE gemini_accounts SET rate_limited_until = datetime('now', '+24 hours'), status = 'free', last_used_at = datetime('now') WHERE id = ?"
  ).run(accountId);
  const account = db.prepare("SELECT email FROM gemini_accounts WHERE id = ?").get(accountId);
  console.log(`[RateLimit] Account #${accountId} (${account?.email}) rate-limited until +24h`);
}

function updateJob(jobId, fields) {
  const sets = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(fields);
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
    ...values,
    jobId
  );
}

function runAutomation({ cookieDir, imagePath, promptText, outputPrefix, imageStyle, skipImageTool }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(PYTHON, [SCRIPT], {
      env: {
        ...process.env,
        COOKIE_DIR: cookieDir,
        IMAGE_PATH: imagePath,
        PROMPT_TEXT: promptText,
        OUTPUT_PREFIX: outputPrefix,
        IMAGE_STYLE: imageStyle || "",
        SKIP_IMAGE_TOOL: skipImageTool ? "1" : "",
      },
      cwd: path.resolve(__dirname, "../../../"),
    });

    // Kill Python process if it exceeds timeout
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.error(`[runAutomation] Timeout after ${BATCH_TIMEOUT_MS / 1000}s — killing Python process`);
        child.kill("SIGKILL");
        reject(new Error(`Automation timed out after ${BATCH_TIMEOUT_MS / 1000}s`));
      }
    }, BATCH_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 2) {
        const err = new Error("RATE_LIMITED");
        err.rateLimited = true;
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(`Automation exited ${code}: ${stderr}`));
      }
      const outputFile = stdout.trim();
      if (!outputFile) {
        return reject(new Error("Automation returned empty output"));
      }
      resolve(outputFile);
    });
  });
}

function runBatchAutomation({ cookieDir, imagePath, imageStyle, skipImageTool, jobsJson, onLine }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(PYTHON, [SCRIPT], {
      env: {
        ...process.env,
        COOKIE_DIR: cookieDir,
        IMAGE_PATH: imagePath,
        IMAGE_STYLE: imageStyle || "",
        SKIP_IMAGE_TOOL: skipImageTool ? "1" : "",
        JOBS_JSON: jobsJson,
      },
      cwd: path.resolve(__dirname, "../../../"),
    });

    // Kill Python process if it exceeds timeout
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.error(`[runBatchAutomation] Timeout after ${BATCH_TIMEOUT_MS / 1000}s — killing Python process`);
        child.kill("SIGKILL");
        reject(new Error(`Batch automation timed out after ${BATCH_TIMEOUT_MS / 1000}s`));
      }
    }, BATCH_TIMEOUT_MS);

    let stdoutBuf = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdoutBuf += d;
      // Process complete lines in real-time
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop(); // keep incomplete last line in buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && onLine) onLine(trimmed);
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      // Process any remaining buffered output
      if (stdoutBuf.trim() && onLine) onLine(stdoutBuf.trim());
      if (code === 2) {
        // Exit code 2 = rate limited
        const err = new Error("RATE_LIMITED");
        err.rateLimited = true;
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(`Batch automation exited ${code}: ${stderr.slice(-500)}`));
      }
      resolve();
    });
  });
}

// ── VPS dispatch helpers ────────────────────────────────────

function getVpsNode(vpsId) {
  return db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(vpsId);
}

/** Build base URL for a VPS node.
 *  If host starts with http(s), treat as full URL (Cloudflare Tunnel, etc.).
 *  Otherwise build http://host:port. */
function getAgentBaseUrl(node) {
  if (node.host.startsWith("http://") || node.host.startsWith("https://")) {
    return node.host.replace(/\/+$/, "");
  }
  return `http://${node.host}:${node.port}`;
}

/** Sync cookie dir from main server to VPS agent before dispatch.
 *  Returns true if sync succeeded or was unnecessary. */
async function syncCookiesToVps(vpsNode, cookieDir) {
  const email = path.basename(cookieDir);
  const baseUrl = getAgentBaseUrl(vpsNode);
  try {
    const res = await fetch(`${baseUrl}/agent/cookies/sync`, {
      method: "POST",
      headers: { "X-Api-Key": vpsNode.secret_key, "Content-Type": "application/json" },
      body: JSON.stringify({ emails: [email] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.warn(`[CookieSync] ${email} → ${vpsNode.name}: HTTP ${res.status}`);
      return false;
    }
    const data = await res.json();
    const ok = data.results?.[email]?.ok ?? false;
    console.log(`[CookieSync] ${email} → ${vpsNode.name}: ${ok ? "OK" : "FAIL"}`);
    return ok;
  } catch (err) {
    console.warn(`[CookieSync] ${email} → ${vpsNode.name}: ${err.message}`);
    return false;
  }
}

async function dispatchSingleToVps(vpsNode, params) {
  const {
    jobId, cookieDir, imagePath, promptText, outputPrefix,
    imageStyle, skipImageTool, batchKey,
  } = params;

  const url = `${getAgentBaseUrl(vpsNode)}/agent/execute`;
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(imagePath);
  formData.append("image", new Blob([fileBuffer]), path.basename(imagePath));
  formData.append("job_id", String(jobId));
  formData.append("cookie_dir", path.basename(cookieDir));
  formData.append("prompt_text", promptText);
  formData.append("output_prefix", outputPrefix);
  formData.append("image_style", imageStyle || "");
  formData.append("skip_image_tool", skipImageTool ? "1" : "");
  formData.append("callback_url", VPS_CALLBACK_URL);
  formData.append("batch_key", batchKey || "");

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Api-Key": vpsNode.secret_key },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VPS dispatch failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function dispatchBatchToVps(vpsNode, params) {
  const {
    cookieDir, imagePath, imageStyle, skipImageTool,
    jobsJson, jobIds, batchKey,
  } = params;

  const url = `${getAgentBaseUrl(vpsNode)}/agent/execute-batch`;
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(imagePath);
  formData.append("image", new Blob([fileBuffer]), path.basename(imagePath));
  formData.append("cookie_dir", path.basename(cookieDir));
  formData.append("image_style", imageStyle || "");
  formData.append("skip_image_tool", skipImageTool ? "1" : "");
  formData.append("jobs_json", jobsJson);
  formData.append("job_ids", JSON.stringify(jobIds));
  formData.append("callback_url", VPS_CALLBACK_URL);
  formData.append("batch_key", batchKey);

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Api-Key": vpsNode.secret_key },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VPS batch dispatch failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function dispatchRegenToVps(vpsNode, params) {
  const {
    jobId, cookieDir, imagePath, outputPrefix, imageStyle,
    skipImageTool, regenConvUrl, regenPrompt, batchKey,
  } = params;

  const url = `${getAgentBaseUrl(vpsNode)}/agent/execute-regen`;
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(imagePath);
  formData.append("image", new Blob([fileBuffer]), path.basename(imagePath));
  formData.append("job_id", String(jobId));
  formData.append("cookie_dir", path.basename(cookieDir));
  formData.append("output_prefix", outputPrefix);
  formData.append("image_style", imageStyle || "");
  formData.append("skip_image_tool", skipImageTool ? "1" : "");
  formData.append("callback_url", VPS_CALLBACK_URL);
  formData.append("regen_conv_url", regenConvUrl);
  formData.append("regen_prompt", regenPrompt);
  formData.append("batch_key", batchKey || "");

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Api-Key": vpsNode.secret_key },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VPS regen dispatch failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// ── Parallel batch runner ───────────────────────────────────
// Each batch (same batch_id) runs on ONE account, jobs sequential within batch.
// Different batches run in PARALLEL on different accounts.

// Map<batchKey, { accountId, jobs: number[], processing: boolean, minJobId: number }>
const batches = new Map();
// Batch keys waiting for a free account — sorted by priority (oldest batch first)
const waitingBatches = [];

function getBatchKey(jobId) {
  const job = db.prepare("SELECT batch_id FROM jobs WHERE id = ?").get(jobId);
  return job?.batch_id || `single_${jobId}`;
}

// Debounce timers for batch start — allows all jobs to be enqueued before processing
const batchStartTimers = new Map();

function enqueueJob(jobId) {
  const batchKey = getBatchKey(jobId);

  if (!batches.has(batchKey)) {
    batches.set(batchKey, { accountId: null, jobs: [], processing: false, minJobId: jobId });
  }
  const batch = batches.get(batchKey);
  batch.jobs.push(jobId);
  if (jobId < batch.minJobId) batch.minJobId = jobId;

  // For multi-job batches, debounce startBatch so all jobs arrive first
  if (!batchKey.startsWith("single_")) {
    if (batchStartTimers.has(batchKey)) {
      clearTimeout(batchStartTimers.get(batchKey));
    }
    batchStartTimers.set(batchKey, setTimeout(() => {
      batchStartTimers.delete(batchKey);
      startBatch(batchKey);
    }, 500));
  } else {
    startBatch(batchKey);
  }
}

/**
 * Try to start processing a batch. If it has no account yet, pick one.
 * If no account available, queue for later.
 */
function startBatch(batchKey) {
  const batch = batches.get(batchKey);
  if (!batch || batch.processing) return;
  if (batch.jobs.length === 0) {
    // Check if there are pending retries that will add jobs back
    const retryCount = pendingRetries.get(batchKey) || 0;
    if (retryCount > 0) {
      // Don't release account yet — retries will add jobs back
      return;
    }
    // Batch done — release account
    if (batch.accountId) {
      console.log(`[Batch ${batchKey}] All jobs done, releasing account #${batch.accountId}`);
      scheduleCooldown(batch.accountId);
    }
    batches.delete(batchKey);
    pendingRetries.delete(batchKey);
    return;
  }

  // Assign account if not yet assigned
  if (!batch.accountId) {
    // Get userId from first job in batch for VPS-aware account selection
    const firstJobId = batch.jobs[0];
    const firstJob = firstJobId ? db.prepare("SELECT user_id FROM jobs WHERE id = ?").get(firstJobId) : null;
    const account = pickAccount(firstJob?.user_id);
    if (!account) {
      // No free account — queue this batch for later (oldest first)
      if (!waitingBatches.includes(batchKey)) {
        waitingBatches.push(batchKey);
        // Sort by minJobId so oldest batches get accounts first
        waitingBatches.sort((a, b) => {
          const batchA = batches.get(a);
          const batchB = batches.get(b);
          return (batchA?.minJobId || Infinity) - (batchB?.minJobId || Infinity);
        });
        console.log(`[Batch ${batchKey}] No free account, queued (${waitingBatches.length} waiting)`);
      }
      return;
    }
    batch.accountId = account.id;
    setAccountStatus(account.id, "busy");
    console.log(`[Batch ${batchKey}] Assigned account ${account.email} (#${account.id})`);
  }

  // Process jobs
  batch.processing = true;

  // Multi-job batch: process ALL jobs in one Gemini conversation
  if (!batchKey.startsWith("single_")) {
    const allJobIds = [...batch.jobs];
    batch.jobs = [];
    processBatchJobs(allJobIds, batch.accountId, batchKey)
      .then((result) => {
        if (result === "vps_dispatched") return; // VPS callback handles completion
        batch.processing = false;
        setTimeout(() => startBatch(batchKey), 200);
      })
      .catch((err) => {
        console.error(`[Batch ${batchKey}] Unhandled error:`, err.message);
        batch.processing = false;
        setTimeout(() => startBatch(batchKey), 200);
      });
    return;
  }

  // Single job: existing one-by-one behavior
  const jobId = batch.jobs.shift();
  processJob(jobId, batch.accountId)
    .then((result) => {
      if (result === "vps_dispatched") return; // VPS callback handles completion
      batch.processing = false;
      setTimeout(() => startBatch(batchKey), 200);
    })
    .catch((err) => {
      console.error(`[Batch ${batchKey}] Unhandled error on job ${jobId}:`, err.message);
      batch.processing = false;
      // If no more jobs left in this batch after error, check retries before releasing
      if (batch.jobs.length === 0 && (pendingRetries.get(batchKey) || 0) === 0) {
        if (batch.accountId) {
          console.log(`[Batch ${batchKey}] All jobs done (with errors), releasing account #${batch.accountId}`);
          scheduleCooldown(batch.accountId);
        }
        batches.delete(batchKey);
        pendingRetries.delete(batchKey);
      } else {
        setTimeout(() => startBatch(batchKey), 200);
      }
    });
}

/**
 * Called when an account becomes free — try to start waiting batches.
 */
function scheduleWaiting() {
  // Try to start each waiting batch — startBatch will pickAccount with correct userId
  const toRetry = [...waitingBatches];
  waitingBatches.length = 0;
  for (const batchKey of toRetry) {
    if (batches.has(batchKey)) {
      startBatch(batchKey);
    }
  }
}

/**
 * Process all jobs in a batch as a single Gemini conversation.
 * On any failure, retry the ENTIRE batch (new conversation).
 */
async function processBatchJobs(jobIds, accountId, batchKey) {
  // Load all jobs and validate
  const jobDataList = [];
  for (const jobId of jobIds) {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) continue;

    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(job.prompt_id);
    if (!prompt) {
      console.error(`[Batch ${batchKey}] Job ${jobId}: Prompt #${job.prompt_id} not found (deleted?)`);
      updateJob(jobId, { status: "error", error: `Prompt #${job.prompt_id} not found (deleted?)` });
      continue;
    }
    jobDataList.push({ job, prompt });
  }

  if (jobDataList.length === 0) return;

  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(accountId);
  if (!account) {
    for (const { job } of jobDataList) {
      updateJob(job.id, { status: "error", error: "Account not found" });
    }
    const batch = batches.get(batchKey);
    if (batch) {
      batch.processing = false;
      batch.jobs = [];
    }
    releaseBatchAfterVps(batchKey);
    return;
  }

  // Get shared config from first job
  const firstPrompt = jobDataList[0].prompt;
  const promptGroup = db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(firstPrompt.group_id);
  const imageStyle = promptGroup?.image_style || "";
  const isLineDrawing = firstPrompt.mode === "line_drawing";
  const isTrade = promptGroup?.role === "trade";

  // Build JOBS_JSON
  const jobsJson = jobDataList.map(({ job, prompt }) => ({
    promptText: prompt.content,
    outputPrefix: isLineDrawing ? `line_${job.id}` : isTrade ? `trade_${job.id}` : `mockup_${job.id}`,
  }));

  const jobIdsStr = jobDataList.map((d) => d.job.id).join(",");

  // ── VPS dispatch ──────────────────────────────────────────
  if (account.vps_id) {
    const vpsNode = getVpsNode(account.vps_id);
    if (!vpsNode || vpsNode.status !== "online") {
      console.error(`[Batch ${batchKey}] VPS #${account.vps_id} is offline or not found`);
      for (const { job } of jobDataList) {
        updateJob(job.id, { status: "error", error: `VPS #${account.vps_id} is offline or not found` });
      }
      // Release account and let waiting batches proceed
      const batch = batches.get(batchKey);
      if (batch) {
        batch.processing = false;
        batch.jobs = [];
      }
      releaseBatchAfterVps(batchKey);
      return;
    }

    // Only set account_id, keep status "pending" — agent "starting" callback
    // will mark each job "processing" one-by-one as it actually runs
    for (const { job } of jobDataList) {
      updateJob(job.id, { account_id: accountId });
    }

    try {
      const jobIdsForVps = jobDataList.map((d) => d.job.id);
      const syncOk = await syncCookiesToVps(vpsNode, account.cookie_dir);
      if (!syncOk) {
        throw new Error(`Cookie sync failed for ${path.basename(account.cookie_dir)} → ${vpsNode.name}`);
      }
      await dispatchBatchToVps(vpsNode, {
        cookieDir: account.cookie_dir,
        imagePath: path.resolve(__dirname, "../../../uploads", jobDataList[0].job.original_image),
        imageStyle,
        skipImageTool: isLineDrawing,
        jobsJson: JSON.stringify(jobsJson),
        jobIds: jobIdsForVps,
        batchKey,
      });
      console.log(`[Batch ${batchKey}] Dispatched ${jobDataList.length} jobs [${jobIdsStr}] to VPS ${vpsNode.name}`);
      return "vps_dispatched";
    } catch (dispatchErr) {
      console.error(`[Batch ${batchKey}] VPS dispatch failed: ${dispatchErr.message}`);
      const currentRetry = Math.max(...jobDataList.map(({ job }) => job.retry_count || 0));
      const next = currentRetry + 1;

      if (next > MAX_BATCH_RETRIES) {
        for (const { job } of jobDataList) {
          updateJob(job.id, { status: "error", error: `VPS dispatch failed after ${MAX_BATCH_RETRIES} retries: ${dispatchErr.message}` });
        }
        // Release account and let waiting batches proceed
        const batch = batches.get(batchKey);
        if (batch) {
          batch.processing = false;
          batch.jobs = [];
        }
        releaseBatchAfterVps(batchKey);
        return;
      }

      const allIds = jobDataList.map((d) => d.job.id);
      for (const id of allIds) {
        updateJob(id, { status: "pending", error: dispatchErr.message, retry_count: next, mockup_image: null });
      }
      pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 0) + 1);
      setTimeout(() => {
        pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 1) - 1);
        const batch = batches.get(batchKey);
        if (batch) {
          if (batch.accountId) {
            scheduleCooldown(batch.accountId);
            batch.accountId = null;
          }
          for (const id of allIds) {
            if (!batch.jobs.includes(id)) batch.jobs.push(id);
          }
          if (!batch.processing) startBatch(batchKey);
        } else {
          batches.set(batchKey, { accountId: null, jobs: [...allIds], processing: false, minJobId: Math.min(...allIds) });
          startBatch(batchKey);
        }
      }, RETRY_DELAY_SEC * 1000);
      return;
    }
  }

  // ── Local execution ───────────────────────────────────────

  // Update first job to processing, rest stay pending (they'll be updated in real-time)
  updateJob(jobDataList[0].job.id, { status: "processing", account_id: accountId });
  for (let i = 1; i < jobDataList.length; i++) {
    updateJob(jobDataList[i].job.id, { status: "pending", account_id: accountId });
  }

  console.log(
    `[Batch ${batchKey}] Processing ${jobDataList.length} jobs [${jobIdsStr}] as single conversation on account ${account.email}`
  );

  const completedSet = new Set();
  try {
    // completedSet is declared outside try so catch can reference it
    await runBatchAutomation({
      cookieDir: account.cookie_dir,
      imagePath: path.resolve(__dirname, "../../../uploads", jobDataList[0].job.original_image),
      imageStyle,
      skipImageTool: isLineDrawing,
      jobsJson: JSON.stringify(jobsJson),
      onLine: (line) => {
        // Real-time status: "STARTING:index" = mark job as processing
        if (line.startsWith("STARTING:")) {
          const idx = parseInt(line.substring(9));
          if (idx >= 0 && idx < jobDataList.length) {
            const { job } = jobDataList[idx];
            updateJob(job.id, { status: "processing" });
            console.log(`[Job ${job.id}] PROCESSING (real-time)`);
          }
          return;
        }
        // Per-job error within batch (after 3 in-conversation retries)
        if (line.startsWith("JOB_ERROR:")) {
          const idx = parseInt(line.substring(10));
          if (idx >= 0 && idx < jobDataList.length) {
            const { job } = jobDataList[idx];
            console.warn(`[Job ${job.id}] FAILED within batch (per-job retries exhausted)`);
          }
          return;
        }
        // Real-time result: "index:filename" = mark job as done
        const colonIdx = line.indexOf(":");
        if (colonIdx < 0) return;
        const idx = parseInt(line.substring(0, colonIdx));
        const filename = line.substring(colonIdx + 1).trim();
        if (idx >= 0 && idx < jobDataList.length && filename) {
          const { job } = jobDataList[idx];
          updateJob(job.id, { mockup_image: filename, status: "done" });
          completedSet.add(idx);
          console.log(`[Job ${job.id}] DONE (real-time): ${filename}`);
        }
      },
    });

    // Mark any jobs that didn't produce output as error
    for (let i = 0; i < jobDataList.length; i++) {
      if (!completedSet.has(i)) {
        const { job } = jobDataList[i];
        if (job.status !== "done") {
          updateJob(job.id, { status: "error", error: "No output received from automation" });
          console.warn(`[Job ${job.id}] No output line received`);
        }
      }
    }

    console.log(`[Batch ${batchKey}] All ${jobDataList.length} jobs completed (${completedSet.size} succeeded)`);
  } catch (err) {
    // ── Rate limit handling: mark account, return incomplete jobs to pending ──
    if (err.rateLimited || err.message === "RATE_LIMITED") {
      const allIds = jobDataList.map((d) => d.job.id);
      const failedIds = allIds.filter((_, i) => !completedSet.has(i));

      console.warn(
        `[Batch ${batchKey}] RATE LIMITED on account #${accountId}. ` +
        `${completedSet.size}/${allIds.length} done, ${failedIds.length} returning to pending.`
      );

      // Mark account as rate-limited (24h cooldown)
      markAccountRateLimited(accountId);

      // Return incomplete jobs to pending WITHOUT incrementing retry_count
      for (const id of failedIds) {
        updateJob(id, { status: "pending", error: null, account_id: null });
      }

      // Release account from batch and try to pick another account
      const batch = batches.get(batchKey);
      if (batch) {
        batch.accountId = null;
        // Re-enqueue ALL failed jobs so they can be picked up by another account
        for (const id of failedIds) {
          if (!batch.jobs.includes(id)) batch.jobs.push(id);
        }
      }

      // Try to start with another account immediately
      scheduleWaiting();
      if (batch && !batch.processing) {
        setTimeout(() => startBatch(batchKey), 500);
      }
      return;
    }

    // Batch failed — retry in a new conversation, up to MAX_BATCH_RETRIES times.
    const allIds = jobDataList.map((d) => d.job.id);
    const failedIds = allIds.filter((_, i) => !completedSet.has(i));

    if (failedIds.length === 0) {
      console.log(`[Batch ${batchKey}] Error occurred but all ${allIds.length} jobs already completed ✓`);
      return;
    }

    const currentRetry = Math.max(...jobDataList.map(({ job }) => job.retry_count || 0));
    const next = currentRetry + 1;

    if (next > MAX_BATCH_RETRIES) {
      console.error(
        `[Batch ${batchKey}] Reached max retries (${MAX_BATCH_RETRIES}). Marking ${failedIds.length} remaining jobs as error.`
      );
      for (const id of failedIds) {
        updateJob(id, {
          status: "error",
          error: `Batch failed after ${MAX_BATCH_RETRIES} retries: ${err.message.slice(0, 300)}`,
          retry_count: next,
        });
      }
      return;
    }

    console.warn(
      `[Batch ${batchKey}] Error (attempt ${next}/${MAX_BATCH_RETRIES}): ${err.message.slice(0, 200)} — retrying ALL ${allIds.length} jobs in new conversation in ${RETRY_DELAY_SEC}s`
    );

    // Reset ALL jobs for fresh batch — prompts are sequential and reference each other,
    // so we must replay the entire conversation to maintain consistency.
    for (const id of allIds) {
      updateJob(id, { status: "pending", error: err.message, retry_count: next, mockup_image: null });
    }

    pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 0) + 1);
    setTimeout(() => {
      pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 1) - 1);
      const batch = batches.get(batchKey);
      if (batch) {
        // Release old account and pick a new free one
        const oldAccountId = batch.accountId;
        if (oldAccountId) {
          scheduleCooldown(oldAccountId);
          batch.accountId = null;
          console.log(`[Batch ${batchKey}] Released account #${oldAccountId} for retry, will pick new account`);
        }
        // Re-enqueue ALL jobs — conversation must be replayed in full
        for (const id of allIds) {
          if (!batch.jobs.includes(id)) batch.jobs.push(id);
        }
        if (!batch.processing) startBatch(batchKey);
      } else {
        batches.set(batchKey, { accountId: null, jobs: [...allIds], processing: false, minJobId: Math.min(...allIds) });
        startBatch(batchKey);
      }
    }, RETRY_DELAY_SEC * 1000);
  }
}

/**
 * Process a single job with a specific account.
 */
async function processJob(jobId, accountId) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job || job.status === "done") return;

  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(accountId);
  if (!account) {
    updateJob(jobId, { status: "error", error: "Account not found" });
    return;
  }

  updateJob(jobId, { status: "processing", account_id: accountId });

  const prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(job.prompt_id);
  if (!prompt) {
    console.error(`[Job ${jobId}] Prompt #${job.prompt_id} not found (deleted?)`);
    updateJob(jobId, { status: "error", error: `Prompt #${job.prompt_id} not found (deleted?)` });
    return;
  }
  const promptGroup = db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(prompt.group_id);
  const imageStyle = promptGroup?.image_style || "";
  const isLineDrawing = prompt?.mode === "line_drawing";
  const isTrade = promptGroup?.role === "trade";
  const outputPrefix = isLineDrawing ? `line_${jobId}` : isTrade ? `trade_${jobId}` : `mockup_${jobId}`;

  // ── VPS dispatch ──────────────────────────────────────────
  if (account.vps_id) {
    const vpsNode = getVpsNode(account.vps_id);
    if (!vpsNode || vpsNode.status !== "online") {
      updateJob(jobId, { status: "error", error: `VPS #${account.vps_id} is offline or not found` });
      return;
    }

    const batchKey = getBatchKey(jobId);
    try {
      const syncOk = await syncCookiesToVps(vpsNode, account.cookie_dir);
      if (!syncOk) {
        throw new Error(`Cookie sync failed for ${path.basename(account.cookie_dir)} → ${vpsNode.name}`);
      }
      await dispatchSingleToVps(vpsNode, {
        jobId,
        cookieDir: account.cookie_dir,
        imagePath: path.resolve(__dirname, "../../../uploads", job.original_image),
        promptText: prompt.content,
        outputPrefix,
        imageStyle,
        skipImageTool: isLineDrawing,
        batchKey,
      });
      console.log(`[Job ${jobId}] Dispatched to VPS ${vpsNode.name}`);
      return "vps_dispatched";
    } catch (dispatchErr) {
      console.error(`[Job ${jobId}] VPS dispatch failed: ${dispatchErr.message}`);
      const currentRetry = job.retry_count || 0;
      if (currentRetry < MAX_RETRIES) {
        const next = currentRetry + 1;
        const delaySec = RETRY_DELAYS[currentRetry] || 5;
        console.warn(`[Job ${jobId}] VPS retry ${next}/${MAX_RETRIES} in ${delaySec}s`);
        updateJob(jobId, { status: "pending", error: dispatchErr.message, retry_count: next });
        pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 0) + 1);
        setTimeout(() => {
          pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 1) - 1);
          const batch = batches.get(batchKey);
          if (batch) {
            batch.jobs.unshift(jobId);
            if (!batch.processing) startBatch(batchKey);
          } else {
            enqueueJob(jobId);
          }
        }, delaySec * 1000);
      } else {
        updateJob(jobId, { status: "error", error: dispatchErr.message });
      }
      return;
    }
  }

  // ── Local execution ───────────────────────────────────────
  console.log(
    `[Job ${jobId}] Starting with account ${account.email} (mode: ${prompt?.mode}, prompt: ${prompt?.content?.slice(0, 50)}...)`
  );

  try {
    const outputFile = await runAutomation({
      cookieDir: account.cookie_dir,
      imagePath: path.resolve(__dirname, "../../../uploads", job.original_image),
      promptText: prompt.content,
      outputPrefix,
      imageStyle,
      skipImageTool: isLineDrawing,
    });
    updateJob(jobId, { mockup_image: outputFile, status: "done" });
    console.log(`[Job ${jobId}] DONE: ${outputFile}`);
  } catch (err) {
    // ── Rate limit: mark account, return job to pending
    if (err.rateLimited || err.message === "RATE_LIMITED") {
      console.warn(`[Job ${jobId}] RATE LIMITED on account #${accountId}`);
      markAccountRateLimited(accountId);
      updateJob(jobId, { status: "pending", error: null, account_id: null });

      const batchKey = getBatchKey(jobId);
      const batch = batches.get(batchKey);
      if (batch) {
        batch.accountId = null;
        if (!batch.jobs.includes(jobId)) batch.jobs.unshift(jobId);
      }
      scheduleWaiting();
      if (batch && !batch.processing) {
        setTimeout(() => startBatch(batchKey), 500);
      }
      return;
    }

    const currentRetry = job.retry_count || 0;
    if (currentRetry < MAX_RETRIES) {
      const next = currentRetry + 1;
      const delaySec = RETRY_DELAYS[currentRetry] || 5;
      console.warn(`[Job ${jobId}] Error (attempt ${next}/${MAX_RETRIES}): ${err.message} — will retry in ${delaySec}s`);
      updateJob(jobId, { status: "pending", error: err.message, retry_count: next });
      // Track that a retry is pending for this batch
      const batchKey = getBatchKey(jobId);
      pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 0) + 1);
      // Re-add to SAME batch after delay
      setTimeout(() => {
        pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 1) - 1);
        const batch = batches.get(batchKey);
        if (batch) {
          batch.jobs.unshift(jobId);
          if (!batch.processing) startBatch(batchKey);
        } else {
          // Batch was already cleaned up — re-enqueue fresh
          enqueueJob(jobId);
        }
      }, delaySec * 1000);
    } else {
      console.error(`[Job ${jobId}] Error after ${MAX_RETRIES} retries:`, err.message);
      updateJob(jobId, { status: "error", error: err.message });
    }
  }
}

// ── VPS callback handler ────────────────────────────────────
// Called by the /api/vps/job-callback endpoint when VPS Agent sends results.

function handleVpsCallback(data) {
  const { type, job_id, batch_key, output_file, error, conversation_url } = data;

  // Auto-detect session expired and disable account immediately
  if (error && /session.expired|not.logged.in/i.test(error)) {
    const batch = batch_key ? batches.get(batch_key) : null;
    if (batch && batch.accountId) {
      console.warn(`[VPS] Session expired detected for account #${batch.accountId}, disabling`);
      db.prepare("UPDATE gemini_accounts SET status = 'disabled', disabled_at = datetime('now') WHERE id = ?").run(batch.accountId);
    }
  }

  switch (type) {
    case "starting":
      if (job_id) {
        // Guard against race condition: don't overwrite terminal status
        const currentJob = db.prepare("SELECT status FROM jobs WHERE id = ?").get(job_id);
        if (currentJob && currentJob.status === "done") {
          console.log(`[VPS] Job ${job_id} starting callback ignored (already done)`);
        } else {
          updateJob(job_id, { status: "processing" });
          console.log(`[VPS] Job ${job_id} processing`);
        }
      }
      break;

    case "done": {
      // Image already saved to outputs/ by the callback endpoint
      const doneUpdate = { mockup_image: output_file, status: "done" };
      if (conversation_url) doneUpdate.conversation_url = conversation_url;
      updateJob(job_id, doneUpdate);
      console.log(`[VPS] Job ${job_id} DONE: ${output_file}`);

      // For single jobs and regen jobs, release batch now (no batch_complete callback)
      if (batch_key && (batch_key.startsWith("single_") || batch_key.startsWith("regen_"))) {
        releaseBatchAfterVps(batch_key);
      }
      break;
    }

    case "job_error":
      // Per-job error within a batch — batch_complete will handle retry
      console.warn(`[VPS] Job ${job_id} error in batch: ${error}`);
      break;

    case "error":
      console.warn(`[VPS] Job ${job_id} error: ${error}`);
      // For single jobs, handle retry
      if (batch_key && batch_key.startsWith("single_")) {
        handleVpsSingleError(job_id, batch_key, error);
      } else if (batch_key && batch_key.startsWith("regen_")) {
        // Regen errors: mark as error directly (regen prompt not stored for retry)
        updateJob(job_id, { status: "error", error });
        releaseBatchAfterVps(batch_key);
      }
      // For batch jobs, batch_complete handles
      break;

    case "rate_limited":
      console.warn(`[VPS] Job ${job_id} RATE LIMITED`);
      if (batch_key && batch_key.startsWith("single_")) {
        handleVpsSingleRateLimit(job_id, batch_key);
      } else if (batch_key && batch_key.startsWith("regen_")) {
        updateJob(job_id, { status: "error", error: "Rate limited during regen" });
        releaseBatchAfterVps(batch_key);
      }
      // For batch: batch_complete follows (with error = RATE_LIMITED)
      break;

    case "batch_error":
      // Per-job batch error — batch_complete will follow
      console.warn(`[VPS] Job ${job_id} batch error: ${error}`);
      break;

    case "batch_complete":
      handleVpsBatchComplete(data);
      break;
  }
}

function handleVpsSingleError(jobId, batchKey, errMsg) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job) return;

  const currentRetry = job.retry_count || 0;
  if (currentRetry < MAX_RETRIES) {
    const next = currentRetry + 1;
    const delaySec = RETRY_DELAYS[currentRetry] || 5;
    console.warn(`[VPS] Job ${jobId} retry ${next}/${MAX_RETRIES} in ${delaySec}s`);
    updateJob(jobId, { status: "pending", error: errMsg, retry_count: next });

    pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 0) + 1);
    setTimeout(() => {
      pendingRetries.set(batchKey, (pendingRetries.get(batchKey) || 1) - 1);
      const batch = batches.get(batchKey);
      if (batch) {
        batch.processing = false;
        batch.jobs.unshift(jobId);
        startBatch(batchKey);
      } else {
        enqueueJob(jobId);
      }
    }, delaySec * 1000);
  } else {
    updateJob(jobId, { status: "error", error: errMsg });
    releaseBatchAfterVps(batchKey);
  }
}

function handleVpsSingleRateLimit(jobId, batchKey) {
  const batch = batches.get(batchKey);
  if (batch && batch.accountId) {
    markAccountRateLimited(batch.accountId);
    batch.accountId = null;
  }

  updateJob(jobId, { status: "pending", error: null, account_id: null });

  if (batch) {
    batch.processing = false;
    if (!batch.jobs.includes(jobId)) batch.jobs.unshift(jobId);
  }

  scheduleWaiting();
  if (batch) {
    setTimeout(() => {
      if (!batch.processing) startBatch(batchKey);
    }, 500);
  }
}

function handleVpsBatchComplete(data) {
  const { batch_key, completed = [], total, error, conversation_url } = data;
  if (!batch_key) return;

  const batch = batches.get(batch_key);
  if (!batch) return;

  const accountId = batch.accountId;

  // Save conversation URL to all jobs in this batch (for regeneration feature)
  if (conversation_url) {
    db.prepare("UPDATE jobs SET conversation_url = ? WHERE batch_id = ?").run(conversation_url, batch_key);
    console.log(`[VPS] Batch ${batch_key} conversation URL saved: ${conversation_url}`);
  }

  if (!error) {
    // Success — jobs already marked done by individual 'done' callbacks
    // Safety net: mark any non-done jobs as error
    const batchJobs = db
      .prepare("SELECT id, status FROM jobs WHERE batch_id = ? ORDER BY id")
      .all(batch_key);
    for (const j of batchJobs) {
      if (j.status !== "done") {
        updateJob(j.id, { status: "error", error: "No output received from VPS automation" });
      }
    }
    console.log(`[VPS] Batch ${batch_key} complete: ${completed.length}/${total} succeeded`);
    releaseBatchAfterVps(batch_key);
    return;
  }

  // Error case — find uncompleted jobs
  const allBatchJobs = db
    .prepare("SELECT id, status, retry_count FROM jobs WHERE batch_id = ? ORDER BY id")
    .all(batch_key);
  const failedJobs = allBatchJobs.filter((j) => j.status !== "done");

  if (failedJobs.length === 0) {
    console.log(`[VPS] Batch ${batch_key} error but all jobs succeeded`);
    releaseBatchAfterVps(batch_key);
    return;
  }

  // Rate limited — mark account, return jobs to pending, try another account
  const isRateLimit = error === "RATE_LIMITED";
  if (isRateLimit) {
    if (accountId) markAccountRateLimited(accountId);
    batch.accountId = null;

    for (const j of failedJobs) {
      updateJob(j.id, { status: "pending", error: null, account_id: null });
      if (!batch.jobs.includes(j.id)) batch.jobs.push(j.id);
    }

    batch.processing = false;
    scheduleWaiting();
    setTimeout(() => startBatch(batch_key), 500);
    return;
  }

  // Other error — retry entire batch
  const currentRetry = Math.max(...allBatchJobs.map((j) => j.retry_count || 0));
  const next = currentRetry + 1;

  if (next > MAX_BATCH_RETRIES) {
    console.error(`[VPS] Batch ${batch_key} max retries (${MAX_BATCH_RETRIES}). Marking ${failedJobs.length} jobs as error.`);
    for (const j of failedJobs) {
      updateJob(j.id, { status: "error", error: `Batch failed after ${MAX_BATCH_RETRIES} retries: ${error}`, retry_count: next });
    }
    releaseBatchAfterVps(batch_key);
    return;
  }

  console.warn(`[VPS] Batch ${batch_key} retry ${next}/${MAX_BATCH_RETRIES} in ${RETRY_DELAY_SEC}s`);

  // Reset ALL jobs for replay (conversation must be complete)
  const allIds = allBatchJobs.map((j) => j.id);
  for (const id of allIds) {
    updateJob(id, { status: "pending", error, retry_count: next, mockup_image: null });
  }

  if (accountId) {
    scheduleCooldown(accountId);
    batch.accountId = null;
  }

  batch.processing = false;
  pendingRetries.set(batch_key, (pendingRetries.get(batch_key) || 0) + 1);
  setTimeout(() => {
    pendingRetries.set(batch_key, (pendingRetries.get(batch_key) || 1) - 1);
    for (const id of allIds) {
      if (!batch.jobs.includes(id)) batch.jobs.push(id);
    }
    startBatch(batch_key);
  }, RETRY_DELAY_SEC * 1000);
}

function releaseBatchAfterVps(batchKey) {
  const batch = batches.get(batchKey);
  if (!batch) return;

  batch.processing = false;

  if (batch.jobs.length === 0 && (pendingRetries.get(batchKey) || 0) === 0) {
    if (batch.accountId) {
      console.log(`[VPS] Batch ${batchKey} done, releasing account #${batch.accountId}`);
      scheduleCooldown(batch.accountId);
    }
    batches.delete(batchKey);
    pendingRetries.delete(batchKey);
  } else {
    setTimeout(() => startBatch(batchKey), 200);
  }
}

// ── Startup: reset stuck accounts & re-queue pending jobs ───

function resetStuckAccounts() {
  const result = db
    .prepare("UPDATE gemini_accounts SET status = 'free' WHERE status IN ('busy', 'cooldown')")
    .run();
  if (result.changes > 0) {
    console.log(`[JobRunner] Reset ${result.changes} stuck account(s) to free`);
  }

  // Log rate-limited accounts
  const rateLimited = db
    .prepare("SELECT id, email, rate_limited_until FROM gemini_accounts WHERE rate_limited_until > datetime('now')")
    .all();
  if (rateLimited.length > 0) {
    for (const a of rateLimited) {
      console.log(`[JobRunner] Account #${a.id} (${a.email}) rate-limited until ${a.rate_limited_until}`);
    }
  }

  const jobResult = db
    .prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing'")
    .run();
  if (jobResult.changes > 0) {
    console.log(`[JobRunner] Reset ${jobResult.changes} stuck job(s) to pending`);
  }

  // Re-queue pending jobs, grouped by batch
  const pendingJobs = db
    .prepare("SELECT id, batch_id FROM jobs WHERE status = 'pending' ORDER BY id ASC")
    .all();
  for (const j of pendingJobs) {
    const batchKey = j.batch_id || `single_${j.id}`;
    if (!batches.has(batchKey)) {
      batches.set(batchKey, { accountId: null, jobs: [], processing: false, minJobId: j.id });
    }
    const batch = batches.get(batchKey);
    batch.jobs.push(j.id);
    if (j.id < batch.minJobId) batch.minJobId = j.id;
  }
  if (pendingJobs.length > 0) {
    console.log(`[JobRunner] Re-queued ${pendingJobs.length} pending job(s) across ${batches.size} batch(es)`);
    // Start batches in order — oldest (lowest minJobId) first
    const sortedBatchKeys = [...batches.keys()].sort((a, b) => {
      const batchA = batches.get(a);
      const batchB = batches.get(b);
      return (batchA?.minJobId || Infinity) - (batchB?.minJobId || Infinity);
    });
    for (const batchKey of sortedBatchKeys) {
      startBatch(batchKey);
    }
  }
}
resetStuckAccounts();

// ── Regeneration ────────────────────────────────────────────

async function regenerateJob(jobId, regenPrompt) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status !== "done") throw new Error("Only completed jobs can be regenerated");

  // Find the account that was used for this job
  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(job.account_id);
  if (!account) throw new Error("Original account not found");

  // Save current mockup_image to previous_images before regenerating
  if (job.mockup_image) {
    const prev = job.previous_images ? JSON.parse(job.previous_images) : [];
    prev.push({ image: job.mockup_image, at: job.updated_at || new Date().toISOString() });
    updateJob(jobId, { previous_images: JSON.stringify(prev) });
  }

  // Mark job as pending for regen, clear mockup_image so UI shows placeholder
  updateJob(jobId, { status: "pending", error: null, mockup_image: null });

  const prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(job.prompt_id);
  const isLineDrawing = prompt?.mode === "line_drawing";
  const promptGroup = prompt?.group_id ? db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(prompt.group_id) : null;
  const imageStyle = promptGroup?.image_style || "";
  const isTrade = promptGroup?.role === "trade";
  const ts = Date.now();
  const outputPrefix = isLineDrawing ? `line_${job.id}_regen_${ts}` : isTrade ? `trade_${job.id}_regen_${ts}` : `mockup_${job.id}_regen_${ts}`;

  // Build the regen prompt text
  const fullRegenPrompt = prompt
    ? `Hãy tạo lại ảnh cho góc "${prompt.name}" với yêu cầu bổ sung sau: ${regenPrompt}`
    : regenPrompt;

  if (account.vps_id) {
    // VPS dispatch
    const vpsNode = getVpsNode(account.vps_id);
    if (!vpsNode || vpsNode.status !== "online") {
      updateJob(jobId, { status: "error", error: "VPS offline" });
      throw new Error("VPS is offline");
    }

    // Lock account during regen
    setAccountStatus(account.id, "busy");
    const batchKey = `regen_${jobId}_${ts}`;
    batches.set(batchKey, { accountId: account.id, jobs: [], processing: true, minJobId: jobId });

    try {
      const syncOk = await syncCookiesToVps(vpsNode, account.cookie_dir);
      if (!syncOk) {
        throw new Error(`Cookie sync failed for ${path.basename(account.cookie_dir)}`);
      }

      if (job.conversation_url) {
        // Has conversation URL → use regen endpoint (continue existing conversation)
        await dispatchRegenToVps(vpsNode, {
          jobId,
          cookieDir: account.cookie_dir,
          imagePath: path.resolve(__dirname, "../../../uploads", job.original_image),
          outputPrefix,
          imageStyle,
          skipImageTool: isLineDrawing || isTrade,
          regenConvUrl: job.conversation_url,
          regenPrompt: fullRegenPrompt,
          batchKey,
        });
        console.log(`[Regen] Job ${jobId} dispatched to VPS ${vpsNode.name} (conversation regen)`);
      } else {
        // No conversation URL → dispatch as fresh single job with modified prompt
        // Use skipImageTool: isLineDrawing only (same as processJob) — trade needs the image tool
        const freshPrompt = prompt
          ? `${prompt.content}\n\nYêu cầu bổ sung: ${regenPrompt}`
          : regenPrompt;
        await dispatchSingleToVps(vpsNode, {
          jobId,
          cookieDir: account.cookie_dir,
          imagePath: path.resolve(__dirname, "../../../uploads", job.original_image),
          promptText: freshPrompt,
          outputPrefix,
          imageStyle,
          skipImageTool: isLineDrawing,
          batchKey,
        });
        console.log(`[Regen] Job ${jobId} dispatched to VPS ${vpsNode.name} (fresh conversation)`);
      }

      // Mark as processing immediately after successful dispatch
      updateJob(jobId, { status: "processing" });

      return { dispatched: true };
    } catch (err) {
      updateJob(jobId, { status: "error", error: `Regen dispatch failed: ${err.message}` });
      // Release account on dispatch failure
      releaseBatchAfterVps(batchKey);
      throw err;
    }
  } else {
    // Local execution (no VPS)
    updateJob(jobId, { status: "error", error: "Local regen not supported — VPS required" });
    throw new Error("Regeneration requires VPS dispatch");
  }
}

module.exports = { enqueueJob, handleVpsCallback, regenerateJob };
