/**
 * VPS Agent — Lightweight service that receives jobs from Main Server,
 * runs gemini_worker.py, and sends results back via callback.
 *
 * Endpoints:
 *   GET  /agent/health              — Health check (no auth)
 *   GET  /agent/status              — Detailed status (auth)
 *   GET  /agent/outputs/:filename   — Download output file (auth)
 *   GET  /agent/cookies             — List available cookie dirs (auth)
 *   POST /agent/execute             — Run single job (auth, multipart)
 *   POST /agent/execute-batch       — Run batch of jobs (auth, multipart)
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const multer = require("multer");
const crypto = require("crypto");
const tar = require("tar");
const { pipeline } = require("stream/promises");

// ── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.AGENT_PORT || "5001");
const SECRET_KEY = process.env.SECRET_KEY || "";
const SERVER_URL = process.env.SERVER_URL || "";
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "3");
const PYTHON = process.env.PYTHON_BIN || "python";
const WORKER_TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT_MS || String(15 * 60 * 1000));

if (!SECRET_KEY) {
  console.error("[Agent] ERROR: SECRET_KEY not set in .env");
  process.exit(1);
}
if (!SERVER_URL) {
  console.error("[Agent] ERROR: SERVER_URL not set in .env");
  process.exit(1);
}

// ── Paths ───────────────────────────────────────────────────

const BASE_DIR = __dirname;
const SCRIPT = path.join(BASE_DIR, "automation", "gemini_worker.py");
const UPLOADS_DIR = path.join(BASE_DIR, "uploads");
const OUTPUTS_DIR = path.join(BASE_DIR, "outputs");
const COOKIES_DIR = path.join(BASE_DIR, "cookies");

for (const dir of [UPLOADS_DIR, OUTPUTS_DIR, COOKIES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Verify worker script exists
if (!fs.existsSync(SCRIPT)) {
  console.error(`[Agent] ERROR: Worker script not found: ${SCRIPT}`);
  console.error("[Agent] Copy gemini_worker.py & selectors.json into agent/automation/");
  process.exit(1);
}

// ── Express setup ───────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const unique = crypto.randomBytes(8).toString("hex");
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── State ───────────────────────────────────────────────────

let activeWorkers = 0;

// ── Auth middleware ─────────────────────────────────────────

function auth(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Logging ─────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

/** Auto-sync a single cookie dir from main server if missing locally. */
async function autoSyncCookie(email) {
  const targetDir = path.join(COOKIES_DIR, email);
  if (fs.existsSync(targetDir)) return true;
  log(`[AutoSync] ${email} not found locally, pulling from server...`);
  try {
    const tarUrl = `${SERVER_URL}/api/vps/cookies-tar/${encodeURIComponent(email)}`;
    const fetchRes = await fetch(tarUrl, {
      headers: { "X-Api-Key": SECRET_KEY },
      signal: AbortSignal.timeout(2 * 60_000),
    });
    if (!fetchRes.ok) {
      log(`[AutoSync] ${email} failed: HTTP ${fetchRes.status}`);
      return false;
    }
    const nodeStream = require("stream").Readable.fromWeb(fetchRes.body);
    await pipeline(nodeStream, tar.extract({ cwd: COOKIES_DIR }));
    const ok = fs.existsSync(targetDir);
    log(`[AutoSync] ${email}: ${ok ? "OK" : "extract failed"}`);
    return ok;
  } catch (err) {
    log(`[AutoSync] ${email} error: ${err.message}`);
    return false;
  }
}

// ── Routes: Health & Status ─────────────────────────────────

app.get("/agent/health", (_req, res) => {
  res.json({ ok: true, active: activeWorkers, max: MAX_CONCURRENT });
});

app.get("/agent/status", auth, (_req, res) => {
  const cookieDirs = [];
  try {
    for (const entry of fs.readdirSync(COOKIES_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) cookieDirs.push(entry.name);
    }
  } catch {}

  res.json({
    ok: true,
    activeWorkers,
    maxConcurrent: MAX_CONCURRENT,
    available: MAX_CONCURRENT - activeWorkers,
    cookieDirs,
    uptime: Math.floor(process.uptime()),
  });
});

app.get("/agent/cookies", auth, (_req, res) => {
  const dirs = [];
  try {
    for (const entry of fs.readdirSync(COOKIES_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(entry.name);
    }
  } catch {}
  res.json(dirs);
});

// ── Routes: Account health check (verify cookies on this VPS) ───

app.post("/agent/account/health", auth, express.json(), (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const safeEmail = path.basename(email);
  const cookieDir = path.join(COOKIES_DIR, safeEmail);

  if (!fs.existsSync(cookieDir)) {
    return res.json({ ok: false, status: "no_cookies", message: "Cookie dir not found on VPS" });
  }

  // Run verify_login.sh to check actual session validity
  try {
    const result = require("child_process").execSync(
      `bash ${path.join(LOGIN_SCRIPTS_DIR, "verify_login.sh")} ${safeEmail} 2>&1`,
      { timeout: 15000, encoding: "utf-8" }
    );
    const ok = result.includes("Login looks GOOD");
    const authCount = (result.match(/Auth cookies found: (\d+)/)?.[1]) || "0";
    log(`[Health] ${safeEmail}: ${ok ? "OK" : "FAIL"} (${authCount}/6 auth cookies)`);
    res.json({
      ok,
      status: ok ? "ok" : "session_expired",
      auth_cookies: parseInt(authCount),
      message: ok ? "Session hoạt động bình thường" : "Session hết hạn — cần đăng nhập lại",
    });
  } catch (err) {
    log(`[Health] ${safeEmail} error: ${err.message}`);
    res.json({ ok: false, status: "error", message: err.message });
  }
});

// ── Routes: Cookie sync (pull from main server) ────────────

app.post("/agent/cookies/sync", auth, express.json(), async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails array required" });
  }

  const force = req.body.force === true;
  const results = {};
  for (const rawEmail of emails) {
    const email = path.basename(rawEmail); // sanitize
    const targetDir = path.join(COOKIES_DIR, email);

    // Skip sync if cookies already exist on VPS (non-destructive)
    // The VPS has fresh cookies from login; re-syncing with main server's
    // stale copy would overwrite Google's rotated session tokens.
    if (!force && fs.existsSync(targetDir)) {
      results[email] = { ok: true, skipped: true };
      log(`[CookieSync] ${email} already exists, skipping (use force=true to overwrite)`);
      continue;
    }

    try {
      // Pull tar stream from main server
      const tarUrl = `${SERVER_URL}/api/vps/cookies-tar/${encodeURIComponent(email)}`;
      const fetchRes = await fetch(tarUrl, {
        headers: { "X-Api-Key": SECRET_KEY },
        signal: AbortSignal.timeout(5 * 60_000), // 5 min for large profiles
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        results[email] = { ok: false, error: `HTTP ${fetchRes.status}: ${errText.slice(0, 200)}` };
        continue;
      }

      // Remove old cookie dir if exists, then extract fresh
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      // Stream response body → tar extract
      const nodeStream = require("stream").Readable.fromWeb(fetchRes.body);
      await pipeline(nodeStream, tar.extract({ cwd: COOKIES_DIR }));

      if (fs.existsSync(targetDir)) {
        results[email] = { ok: true };
        log(`[CookieSync] ${email} synced successfully`);
      } else {
        results[email] = { ok: false, error: "Extract completed but dir not found" };
      }
    } catch (err) {
      results[email] = { ok: false, error: err.message };
      log(`[CookieSync] ${email} failed: ${err.message}`);
    }
  }

  res.json({ ok: true, results });
});

// ── Routes: VPS Login Management (noVNC) ────────────────────

const LOGIN_SCRIPTS_DIR = path.join(BASE_DIR, "..", "automation");

app.post("/agent/login/start", auth, express.json(), (req, res) => {
  const { email, reset } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const safeEmail = path.basename(email);

  // Stop any existing session first
  try {
    require("child_process").execSync(
      `bash ${path.join(LOGIN_SCRIPTS_DIR, "stop_login.sh")} 2>/dev/null`,
      { timeout: 15000, stdio: "pipe" }
    );
  } catch {}

  // Start login session
  const args = [safeEmail];
  if (reset) args.push("--reset");
  const child = spawn("bash", [path.join(LOGIN_SCRIPTS_DIR, "start_login.sh"), ...args], {
    cwd: BASE_DIR,
    timeout: 600_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: process.env.HOME || "/home/mockup" },
  });

  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stdout += d));

  // Wait a few seconds for noVNC to start
  setTimeout(() => {
    // Get local IP for noVNC URL
    const os = require("os");
    const nets = os.networkInterfaces();
    let ip = "localhost";
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces) {
        if (iface.family === "IPv4" && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
    }
    const vncUrl = `http://${ip}:6080/vnc.html`;
    log(`[Login] Started for ${safeEmail}, noVNC: ${vncUrl}`);
    res.json({ ok: true, vnc_url: vncUrl, message: `noVNC started for ${safeEmail}` });
  }, 3000);

  child.on("error", (err) => {
    log(`[Login] Start error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.post("/agent/login/stop", auth, express.json(), (req, res) => {
  try {
    const result = require("child_process").execSync(
      `bash ${path.join(LOGIN_SCRIPTS_DIR, "stop_login.sh")} 2>&1`,
      { timeout: 30000, encoding: "utf-8" }
    );
    log(`[Login] Stopped: ${result.trim()}`);
    res.json({ ok: true, message: result.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/agent/login/verify", auth, express.json(), (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const safeEmail = path.basename(email);

  try {
    const result = require("child_process").execSync(
      `bash ${path.join(LOGIN_SCRIPTS_DIR, "verify_login.sh")} ${safeEmail} 2>&1`,
      { timeout: 15000, encoding: "utf-8" }
    );
    const ok = result.includes("Login looks GOOD");
    const authCount = (result.match(/Auth cookies found: (\d+)/)?.[1]) || "0";
    log(`[Login] Verify ${safeEmail}: ${ok ? "OK" : "FAIL"} (${authCount}/6 auth cookies)`);
    res.json({ ok, auth_cookies: parseInt(authCount), message: result.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/agent/login/cookies-upload", auth, (req, res) => {
  // Stream the cookies SQLite file as tar to the requester (backend)
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email required" });
  const safeEmail = path.basename(String(email));
  const cookieDir = path.join(COOKIES_DIR, safeEmail);

  if (!fs.existsSync(cookieDir)) {
    return res.status(404).json({ error: "Cookie dir not found" });
  }

  // Delete exported_cookies.json before streaming (not needed on server)
  const exportedJson = path.join(cookieDir, "exported_cookies.json");
  try { if (fs.existsSync(exportedJson)) fs.unlinkSync(exportedJson); } catch {}

  // Ensure cookie_platform.txt exists
  const platformFile = path.join(cookieDir, "cookie_platform.txt");
  if (!fs.existsSync(platformFile)) {
    fs.writeFileSync(platformFile, "Linux\n");
  }

  // Stream tar of essential cookie files (both old and new Chromium paths)
  const filesToTar = [];
  const defaultCookies = path.join("Default", "Cookies");
  const defaultJournal = path.join("Default", "Cookies-journal");
  const networkCookies = path.join("Default", "Network", "Cookies");
  const networkJournal = path.join("Default", "Network", "Cookies-journal");
  if (fs.existsSync(path.join(cookieDir, defaultCookies))) filesToTar.push(path.join(safeEmail, defaultCookies));
  if (fs.existsSync(path.join(cookieDir, defaultJournal))) filesToTar.push(path.join(safeEmail, defaultJournal));
  if (fs.existsSync(path.join(cookieDir, networkCookies))) filesToTar.push(path.join(safeEmail, networkCookies));
  if (fs.existsSync(path.join(cookieDir, networkJournal))) filesToTar.push(path.join(safeEmail, networkJournal));
  filesToTar.push(path.join(safeEmail, "cookie_platform.txt"));

  if (filesToTar.length < 2) {
    return res.status(404).json({ error: "No cookies found after login" });
  }

  res.setHeader("Content-Type", "application/x-tar");
  tar.create({ cwd: COOKIES_DIR, gzip: false }, filesToTar).pipe(res);
});

// ── Routes: Output download (fallback) ─────────────────────

app.get("/agent/outputs/:filename", auth, (req, res) => {
  const safe = path.basename(req.params.filename);
  const filePath = path.join(OUTPUTS_DIR, safe);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.sendFile(filePath);
});

// ── Routes: Execute single job ──────────────────────────────

app.post("/agent/execute", auth, upload.single("image"), async (req, res) => {
  if (activeWorkers >= MAX_CONCURRENT) {
    cleanupFile(req.file);
    return res.status(503).json({ error: "Agent busy", active: activeWorkers, max: MAX_CONCURRENT });
  }

  const { job_id, cookie_dir, prompt_text, output_prefix, image_style, skip_image_tool, callback_url, batch_key } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "image file required" });
  }
  if (!cookie_dir || !prompt_text || !output_prefix) {
    cleanupFile(req.file);
    return res.status(400).json({ error: "cookie_dir, prompt_text, output_prefix required" });
  }

  const cookiePath = path.join(COOKIES_DIR, path.basename(cookie_dir));
  if (!fs.existsSync(cookiePath)) {
    const synced = await autoSyncCookie(path.basename(cookie_dir));
    if (!synced) {
      cleanupFile(req.file);
      return res.status(400).json({ error: `Cookie dir not found: ${cookie_dir}` });
    }
  }

  activeWorkers++;
  const imagePath = req.file.path;
  log(`[Job ${job_id}] Accepted (${activeWorkers}/${MAX_CONCURRENT} workers)`);

  res.status(202).json({ accepted: true, job_id });

  // Run async — don't await
  executeSingleJob({
    job_id, cookiePath, imagePath, prompt_text, output_prefix,
    image_style, skip_image_tool, callback_url, batch_key,
  });
});

async function executeSingleJob(params) {
  const { job_id, cookiePath, imagePath, prompt_text, output_prefix, image_style, skip_image_tool, callback_url, batch_key } = params;
  try {
    // Notify backend that job is processing
    await sendCallback(callback_url, {
      type: "starting",
      job_id: parseInt(job_id),
      batch_key,
    }).catch(() => {});

    const rawOutput = await spawnWorker({
      cookieDir: cookiePath,
      imagePath,
      promptText: prompt_text,
      outputPrefix: output_prefix,
      imageStyle: image_style || "",
      skipImageTool: skip_image_tool === "1" || skip_image_tool === true,
    });

    // Parse output: may contain CONV_URL:xxx and filename
    let outputFile = null;
    let convUrl = null;
    for (const ln of rawOutput.split("\n")) {
      const t = ln.trim();
      if (t.startsWith("CONV_URL:")) {
        convUrl = t.substring(9);
      } else if (t) {
        outputFile = t;
      }
    }

    log(`[Job ${job_id}] Success: ${outputFile}`);

    const outputPath = path.join(OUTPUTS_DIR, outputFile);
    let imageBase64 = null;
    if (fs.existsSync(outputPath)) {
      imageBase64 = fs.readFileSync(outputPath).toString("base64");
    }

    await sendCallback(callback_url, {
      type: "done",
      job_id: parseInt(job_id),
      batch_key,
      output_file: outputFile,
      image_base64: imageBase64,
      conversation_url: convUrl,
    });
  } catch (err) {
    log(`[Job ${job_id}] Error: ${err.message}`);
    await sendCallback(callback_url, {
      type: err.rateLimited ? "rate_limited" : "error",
      job_id: parseInt(job_id),
      batch_key,
      error: err.message,
      reset_time: err.resetTime || null,
    }).catch(e => log(`[Job ${job_id}] Callback failed: ${e.message}`));
  } finally {
    activeWorkers--;
    cleanupFile({ path: imagePath });
  }
}

// ── Routes: Execute regen (single image regeneration) ───────

app.post("/agent/execute-regen", auth, upload.single("image"), async (req, res) => {
  if (activeWorkers >= MAX_CONCURRENT) {
    cleanupFile(req.file);
    return res.status(503).json({ error: "Agent busy", active: activeWorkers, max: MAX_CONCURRENT });
  }

  const { job_id, cookie_dir, output_prefix, image_style, skip_image_tool, callback_url, regen_conv_url, regen_prompt, batch_key } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "image file required" });
  }
  if (!cookie_dir || !regen_conv_url || !regen_prompt || !output_prefix) {
    cleanupFile(req.file);
    return res.status(400).json({ error: "cookie_dir, regen_conv_url, regen_prompt, output_prefix required" });
  }

  const cookiePath = path.join(COOKIES_DIR, path.basename(cookie_dir));
  if (!fs.existsSync(cookiePath)) {
    const synced = await autoSyncCookie(path.basename(cookie_dir));
    if (!synced) {
      cleanupFile(req.file);
      return res.status(400).json({ error: `Cookie dir not found: ${cookie_dir}` });
    }
  }

  activeWorkers++;
  const imagePath = req.file.path;
  log(`[Regen ${job_id}] Accepted (${activeWorkers}/${MAX_CONCURRENT} workers)`);

  res.status(202).json({ accepted: true, job_id });

  executeRegenJob({
    job_id, cookiePath, imagePath, output_prefix,
    image_style, skip_image_tool, callback_url,
    regen_conv_url, regen_prompt, batch_key,
  });
});

async function executeRegenJob(params) {
  const { job_id, cookiePath, imagePath, output_prefix, image_style, skip_image_tool, callback_url, regen_conv_url, regen_prompt, batch_key } = params;
  try {
    // Notify backend that job is processing
    await sendCallback(callback_url, {
      type: "starting",
      job_id: parseInt(job_id),
      batch_key,
    }).catch(() => {});

    const outputFile = await spawnRegenWorker({
      cookieDir: cookiePath,
      imagePath,
      outputPrefix: output_prefix,
      imageStyle: image_style || "",
      skipImageTool: skip_image_tool === "1" || skip_image_tool === true,
      regenConvUrl: regen_conv_url,
      regenPrompt: regen_prompt,
    });

    log(`[Regen ${job_id}] Success: ${outputFile}`);

    const outputPath = path.join(OUTPUTS_DIR, outputFile);
    let imageBase64 = null;
    if (fs.existsSync(outputPath)) {
      imageBase64 = fs.readFileSync(outputPath).toString("base64");
    }

    await sendCallback(callback_url, {
      type: "done",
      job_id: parseInt(job_id),
      batch_key,
      output_file: outputFile,
      image_base64: imageBase64,
    });
  } catch (err) {
    log(`[Regen ${job_id}] Error: ${err.message}`);
    await sendCallback(callback_url, {
      type: err.rateLimited ? "rate_limited" : "error",
      job_id: parseInt(job_id),
      batch_key,
      error: err.message,
      reset_time: err.resetTime || null,
    }).catch(e => log(`[Regen ${job_id}] Callback failed: ${e.message}`));
  } finally {
    activeWorkers--;
    cleanupFile({ path: imagePath });
  }
}

// ── Routes: Execute batch ───────────────────────────────────

app.post("/agent/execute-batch", auth, upload.single("image"), async (req, res) => {
  if (activeWorkers >= MAX_CONCURRENT) {
    cleanupFile(req.file);
    return res.status(503).json({ error: "Agent busy", active: activeWorkers, max: MAX_CONCURRENT });
  }

  const { cookie_dir, image_style, skip_image_tool, jobs_json, job_ids, callback_url, batch_key } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "image file required" });
  }
  if (!cookie_dir || !jobs_json || !job_ids) {
    cleanupFile(req.file);
    return res.status(400).json({ error: "cookie_dir, jobs_json, job_ids required" });
  }

  const cookiePath = path.join(COOKIES_DIR, path.basename(cookie_dir));
  if (!fs.existsSync(cookiePath)) {
    const synced = await autoSyncCookie(path.basename(cookie_dir));
    if (!synced) {
      cleanupFile(req.file);
      return res.status(400).json({ error: `Cookie dir not found: ${cookie_dir}` });
    }
  }

  let jobIdList;
  try {
    jobIdList = typeof job_ids === "string" ? JSON.parse(job_ids) : job_ids;
  } catch {
    cleanupFile(req.file);
    return res.status(400).json({ error: "job_ids must be a JSON array" });
  }

  activeWorkers++;
  const imagePath = req.file.path;
  log(`[Batch ${batch_key}] Accepted ${jobIdList.length} jobs (${activeWorkers}/${MAX_CONCURRENT} workers)`);

  res.status(202).json({ accepted: true, batch_key, job_count: jobIdList.length });

  executeBatchJob({
    cookiePath, imagePath, image_style, skip_image_tool,
    jobs_json, jobIdList, callback_url, batch_key,
  });
});

async function executeBatchJob(params) {
  const { cookiePath, imagePath, image_style, skip_image_tool, jobs_json, jobIdList, callback_url, batch_key } = params;
  const completedSet = new Set();
  let batchConvUrl = null;

  try {
    await spawnBatchWorker({
      cookieDir: cookiePath,
      imagePath,
      imageStyle: image_style || "",
      skipImageTool: skip_image_tool === "1" || skip_image_tool === true,
      jobsJson: jobs_json,
      onLine: async (line) => {
        // CONV_URL:url — conversation URL for regeneration
        if (line.startsWith("CONV_URL:")) {
          batchConvUrl = line.substring(9);
          log(`[Batch ${batch_key}] Conversation URL: ${batchConvUrl}`);
          return;
        }

        // STARTING:index
        if (line.startsWith("STARTING:")) {
          const idx = parseInt(line.substring(9));
          if (idx >= 0 && idx < jobIdList.length) {
            log(`[Batch ${batch_key}] Job ${jobIdList[idx]} processing`);
            await sendCallback(callback_url, {
              type: "starting",
              job_id: jobIdList[idx],
              batch_key,
            }).catch(() => {});
          }
          return;
        }

        // JOB_ERROR:index
        if (line.startsWith("JOB_ERROR:")) {
          const idx = parseInt(line.substring(10));
          if (idx >= 0 && idx < jobIdList.length) {
            log(`[Batch ${batch_key}] Job ${jobIdList[idx]} failed in-batch`);
            await sendCallback(callback_url, {
              type: "job_error",
              job_id: jobIdList[idx],
              batch_key,
              error: "Worker per-job error (retries exhausted within batch)",
            }).catch(() => {});
          }
          return;
        }

        // index:filename — job completed
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const idx = parseInt(line.substring(0, colonIdx));
          const filename = line.substring(colonIdx + 1).trim();
          if (idx >= 0 && idx < jobIdList.length && filename) {
            completedSet.add(idx);
            log(`[Batch ${batch_key}] Job ${jobIdList[idx]} done: ${filename}`);

            const outputPath = path.join(OUTPUTS_DIR, filename);
            let imageBase64 = null;
            if (fs.existsSync(outputPath)) {
              imageBase64 = fs.readFileSync(outputPath).toString("base64");
            }

            await sendCallback(callback_url, {
              type: "done",
              job_id: jobIdList[idx],
              batch_key,
              output_file: filename,
              image_base64: imageBase64,
            }).catch(() => {});
          }
        }
      },
    });

    // Mark remaining jobs as no-output error
    for (let i = 0; i < jobIdList.length; i++) {
      if (!completedSet.has(i)) {
        await sendCallback(callback_url, {
          type: "error",
          job_id: jobIdList[i],
          batch_key,
          error: "No output from automation",
        }).catch(() => {});
      }
    }

    log(`[Batch ${batch_key}] Complete: ${completedSet.size}/${jobIdList.length} succeeded`);
    await sendCallback(callback_url, {
      type: "batch_complete",
      batch_key,
      completed: [...completedSet].map(i => jobIdList[i]),
      total: jobIdList.length,
      conversation_url: batchConvUrl,
    }).catch(() => {});

  } catch (err) {
    log(`[Batch ${batch_key}] Error: ${err.message}`);
    const errType = err.rateLimited ? "rate_limited" : "batch_error";

    for (let i = 0; i < jobIdList.length; i++) {
      if (!completedSet.has(i)) {
        await sendCallback(callback_url, {
          type: errType,
          job_id: jobIdList[i],
          batch_key,
          error: err.message,
          reset_time: err.resetTime || null,
        }).catch(() => {});
      }
    }

    await sendCallback(callback_url, {
      type: "batch_complete",
      batch_key,
      completed: [...completedSet].map(i => jobIdList[i]),
      total: jobIdList.length,
      error: err.message,
      reset_time: err.resetTime || null,
    }).catch(() => {});

  } finally {
    activeWorkers--;
    cleanupFile({ path: imagePath });
  }
}

// ── Worker: spawn single ────────────────────────────────────

function spawnWorker({ cookieDir, imagePath, promptText, outputPrefix, imageStyle, skipImageTool }) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const child = spawn(PYTHON, [SCRIPT], {
      env: {
        ...process.env,
        HEADLESS: "1",
        COOKIE_DIR: cookieDir,
        IMAGE_PATH: imagePath,
        PROMPT_TEXT: promptText,
        OUTPUT_PREFIX: outputPrefix,
        IMAGE_STYLE: imageStyle,
        SKIP_IMAGE_TOOL: skipImageTool ? "1" : "",
      },
      cwd: BASE_DIR,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`));
      }
    }, WORKER_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d); // real-time logging
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (code === 2) {
        const err = new Error("RATE_LIMITED");
        err.rateLimited = true;
        const rlLine = stdout.split("\n").find(l => l.startsWith("RATE_LIMITED:"));
        if (rlLine && rlLine.length > 13) {
          err.resetTime = rlLine.substring(13).trim();
        }
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(`Worker exited ${code}: ${stderr.slice(-500)}`));
      }
      const output = stdout.trim();
      if (!output) {
        return reject(new Error("Worker returned empty output"));
      }
      resolve(output);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

// ── Worker: spawn regen ─────────────────────────────────────

function spawnRegenWorker({ cookieDir, imagePath, outputPrefix, imageStyle, skipImageTool, regenConvUrl, regenPrompt }) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const child = spawn(PYTHON, [SCRIPT], {
      env: {
        ...process.env,
        HEADLESS: "1",
        COOKIE_DIR: cookieDir,
        IMAGE_PATH: imagePath,
        OUTPUT_PREFIX: outputPrefix,
        IMAGE_STYLE: imageStyle,
        SKIP_IMAGE_TOOL: skipImageTool ? "1" : "",
        REGEN_MODE: "1",
        REGEN_CONV_URL: regenConvUrl,
        REGEN_PROMPT: regenPrompt,
      },
      cwd: BASE_DIR,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Regen worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`));
      }
    }, WORKER_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d; });
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
        // Parse reset time from stdout: "RATE_LIMITED:2026-04-17T14:45:00"
        const rlLine = stdout.split("\n").find(l => l.startsWith("RATE_LIMITED:"));
        if (rlLine && rlLine.length > 13) {
          err.resetTime = rlLine.substring(13).trim();
        }
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(`Regen worker exited ${code}: ${stderr.slice(-500)}`));
      }
      const output = stdout.trim().split("\n").filter(l => !l.startsWith("CONV_URL:") && !l.startsWith("RATE_LIMITED")).pop();
      if (!output) {
        return reject(new Error("Regen worker returned empty output"));
      }
      resolve(output);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

// ── Worker: spawn batch ─────────────────────────────────────

function spawnBatchWorker({ cookieDir, imagePath, imageStyle, skipImageTool, jobsJson, onLine }) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const child = spawn(PYTHON, [SCRIPT], {
      env: {
        ...process.env,
        HEADLESS: "1",
        COOKIE_DIR: cookieDir,
        IMAGE_PATH: imagePath,
        IMAGE_STYLE: imageStyle,
        SKIP_IMAGE_TOOL: skipImageTool ? "1" : "",
        JOBS_JSON: jobsJson,
      },
      cwd: BASE_DIR,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Batch worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`));
      }
    }, WORKER_TIMEOUT_MS);

    let stdoutBuf = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdoutBuf += d;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop(); // keep incomplete last line
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
      // Process remaining buffered output
      if (stdoutBuf.trim() && onLine) onLine(stdoutBuf.trim());

      if (code === 2) {
        const err = new Error("RATE_LIMITED");
        err.rateLimited = true;
        // Parse reset time from buffered stdout
        const rlLine = (stdoutBuf || "").split("\n").find(l => l.startsWith("RATE_LIMITED:"));
        if (rlLine && rlLine.length > 13) {
          err.resetTime = rlLine.substring(13).trim();
        }
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(`Batch worker exited ${code}: ${stderr.slice(-500)}`));
      }
      resolve();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

// ── Callback to Main Server ────────────────────────────────

function sendCallback(callbackUrl, data) {
  if (!callbackUrl) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      const url = new URL(callbackUrl);
      const isHttps = url.protocol === "https:";
      const postData = JSON.stringify(data);

      const opts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "X-Api-Key": SECRET_KEY,
        },
        timeout: 30_000,
      };

      const client = isHttps ? https : http;
      const req = client.request(opts, (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(buf);
          } else {
            reject(new Error(`Callback HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Callback timeout (30s)"));
      });
      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Heartbeat ───────────────────────────────────────────────

let cookiesSynced = false; // only auto-sync once on startup

async function syncCookiesFromServer(emails) {
  const missing = emails.filter(
    (e) => !fs.existsSync(path.join(COOKIES_DIR, e))
  );
  if (missing.length === 0) return;

  log(`[CookieSync] Auto-syncing ${missing.length} missing cookie(s): ${missing.join(", ")}`);

  for (const email of missing) {
    const tarUrl = `${SERVER_URL}/api/vps/cookies-tar/${encodeURIComponent(email)}`;
    try {
      const fetchRes = await fetch(tarUrl, {
        headers: { "X-Api-Key": SECRET_KEY },
        signal: AbortSignal.timeout(5 * 60_000),
      });
      if (!fetchRes.ok) {
        log(`[CookieSync] ${email}: HTTP ${fetchRes.status}`);
        continue;
      }
      const nodeStream = require("stream").Readable.fromWeb(fetchRes.body);
      await pipeline(nodeStream, tar.extract({ cwd: COOKIES_DIR }));
      if (fs.existsSync(path.join(COOKIES_DIR, email))) {
        log(`[CookieSync] ${email}: OK`);
      } else {
        log(`[CookieSync] ${email}: extracted but dir not found`);
      }
    } catch (err) {
      log(`[CookieSync] ${email}: ${err.message}`);
    }
  }
}

function startHeartbeat() {
  const heartbeatUrl = `${SERVER_URL}/api/vps/heartbeat`;

  const send = () => {
    sendCallback(heartbeatUrl, { secret_key: SECRET_KEY })
      .then(async (rawResponse) => {
        // Auto-sync cookies on first successful heartbeat
        if (!cookiesSynced && rawResponse) {
          try {
            const response = JSON.parse(rawResponse);
            if (Array.isArray(response.accounts) && response.accounts.length > 0) {
              cookiesSynced = true;
              syncCookiesFromServer(response.accounts).catch((err) => {
                log(`[CookieSync] Auto-sync error: ${err.message}`);
              });
            } else {
              cookiesSynced = true; // no accounts assigned, skip
            }
          } catch {}
        }
      })
      .catch((err) => {
        log(`[Heartbeat] Failed: ${err.message}`);
      });
  };

  send(); // immediate first heartbeat
  setInterval(send, 30_000);
  log("[Heartbeat] Started (every 30s)");
}

// ── Cleanup ─────────────────────────────────────────────────

function cleanupFile(file) {
  if (file && file.path) {
    try { fs.unlinkSync(file.path); } catch {}
  }
}

// ── Start ───────────────────────────────────────────────────

app.listen(PORT, () => {
  log("═══════════════════════════════════════════════");
  log(`  VPS Agent started on port ${PORT}`);
  log(`  Server URL: ${SERVER_URL}`);
  log(`  Max concurrent workers: ${MAX_CONCURRENT}`);
  log(`  Worker timeout: ${WORKER_TIMEOUT_MS / 1000}s`);
  log(`  Cookies dir: ${COOKIES_DIR}`);
  log("═══════════════════════════════════════════════");
  startHeartbeat();
});
