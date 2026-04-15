const { Router } = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const AdmZip = require("adm-zip");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = Router();

const SAFE_EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

const PYTHON = process.env.PYTHON_BIN || "python";
const SETUP_SCRIPT = path.resolve(__dirname, "../../../automation/setup_account.py");
const COOKIES_DIR = path.resolve(__dirname, "../../../cookies");

// Multer for zip upload (max 200MB)
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed" || /\.zip$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files allowed"));
    }
  },
});

/**
 * @swagger
 * /api/accounts:
 *   get:
 *     tags: [Gemini Accounts]
 *     summary: Danh sách tài khoản Gemini (admin only, shared pool)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mảng tài khoản Gemini
 */
router.get("/", authMiddleware, adminOnly, (req, res) => {
  const accounts = db.prepare(`
    SELECT ga.*, vn.name AS vps_name
    FROM gemini_accounts ga
    LEFT JOIN vps_nodes vn ON ga.vps_id = vn.id
    ORDER BY ga.id
  `).all();
  res.json(accounts);
});

/**
 * @swagger
 * /api/accounts:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Thêm tài khoản Gemini cho chính mình
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, cookie_dir]
 *             properties:
 *               email:
 *                 type: string
 *               cookie_dir:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tài khoản đã tạo
 */
router.post("/", authMiddleware, adminOnly, (req, res) => {
  const { email, cookie_dir } = req.body;
  if (!email || !cookie_dir) {
    return res.status(400).json({ error: "Email and cookie_dir required" });
  }
  const existing = db.prepare("SELECT id FROM gemini_accounts WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "Email này đã tồn tại" });
  }
  const info = db
    .prepare("INSERT INTO gemini_accounts (email, cookie_dir, user_id) VALUES (?, ?, ?)")
    .run(email, cookie_dir, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid, email, cookie_dir, status: "free" });
});

/**
 * @swagger
 * /api/accounts/{id}:
 *   put:
 *     tags: [Gemini Accounts]
 *     summary: Cập nhật tài khoản Gemini (chủ sở hữu hoặc admin)
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id", authMiddleware, adminOnly, (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  const { email, cookie_dir, status } = req.body;
  db.prepare(
    "UPDATE gemini_accounts SET email = COALESCE(?, email), cookie_dir = COALESCE(?, cookie_dir), status = COALESCE(?, status) WHERE id = ?"
  ).run(email || null, cookie_dir || null, status || null, accountId);
  res.json({ ok: true });
});

/**
 * @swagger
 * /api/accounts/{id}:
 *   delete:
 *     tags: [Gemini Accounts]
 *     summary: Xóa tài khoản Gemini (chủ sở hữu hoặc admin)
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:id", authMiddleware, adminOnly, (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  db.prepare("DELETE FROM gemini_accounts WHERE id = ?").run(accountId);
  res.json({ ok: true });
});

/**
 * @swagger
 * /api/accounts/{id}/reset:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Reset trạng thái tài khoản về free
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/reset", authMiddleware, adminOnly, (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare("SELECT * FROM gemini_accounts WHERE id = ?").get(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  db.prepare("UPDATE gemini_accounts SET status = 'free', rate_limited_until = NULL WHERE id = ?").run(accountId);
  res.json({ ok: true });
});

/**
 * @swagger
 * /api/accounts/{id}/health:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Kiểm tra session Gemini qua VPS agent
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/health", authMiddleware, adminOnly, async (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare(`
    SELECT ga.*, vn.host, vn.port, vn.secret_key, vn.name AS vps_name
    FROM gemini_accounts ga
    LEFT JOIN vps_nodes vn ON ga.vps_id = vn.id
    WHERE ga.id = ?
  `).get(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  if (!account.vps_id || !account.host) {
    return res.json({ status: "error", message: "Account chưa gán VPS" });
  }

  try {
    const baseUrl = account.host.startsWith("http")
      ? account.host.replace(/\/+$/, "")
      : `http://${account.host}:${account.port}`;

    const resp = await fetch(`${baseUrl}/agent/account/health`, {
      method: "POST",
      headers: { "X-Api-Key": account.secret_key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      return res.json({ status: "error", message: `VPS agent error: HTTP ${resp.status}` });
    }

    const data = await resp.json();

    // Auto-update DB status based on VPS result
    if (data.status === "session_expired" || data.status === "no_cookies") {
      db.prepare("UPDATE gemini_accounts SET status = 'disabled' WHERE id = ?").run(accountId);
    } else if (data.ok && account.status === "disabled") {
      db.prepare("UPDATE gemini_accounts SET status = 'free' WHERE id = ?").run(accountId);
    }

    res.json({
      status: data.ok ? "ok" : "error",
      message: data.message,
      auth_cookies: data.auth_cookies,
      vps: account.vps_name,
    });
  } catch (err) {
    res.json({ status: "error", message: `Không thể kết nối VPS ${account.vps_name}: ${err.message}` });
  }
});

/**
 * @swagger
 * /api/accounts/health-all:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Kiểm tra tất cả sessions qua VPS agents
 *     security:
 *       - bearerAuth: []
 */
router.post("/health-all", authMiddleware, adminOnly, async (req, res) => {
  const accounts = db.prepare(`
    SELECT ga.*, vn.host, vn.port, vn.secret_key, vn.name AS vps_name
    FROM gemini_accounts ga
    LEFT JOIN vps_nodes vn ON ga.vps_id = vn.id
    ORDER BY ga.id
  `).all();

  const promises = accounts.map(async (account) => {
    if (!account.vps_id || !account.host) {
      return { id: account.id, email: account.email, status: "error", message: "Chưa gán VPS" };
    }

    try {
      const baseUrl = account.host.startsWith("http")
        ? account.host.replace(/\/+$/, "")
        : `http://${account.host}:${account.port}`;

      const resp = await fetch(`${baseUrl}/agent/account/health`, {
        method: "POST",
        headers: { "X-Api-Key": account.secret_key, "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        return { id: account.id, email: account.email, status: "error", message: `HTTP ${resp.status}` };
      }

      const data = await resp.json();

      if (data.status === "session_expired" || data.status === "no_cookies") {
        db.prepare("UPDATE gemini_accounts SET status = 'disabled' WHERE id = ?").run(account.id);
      } else if (data.ok && account.status === "disabled") {
        db.prepare("UPDATE gemini_accounts SET status = 'free' WHERE id = ?").run(account.id);
      }

      return { id: account.id, email: account.email, status: data.ok ? "ok" : "error", message: data.message };
    } catch (err) {
      return { id: account.id, email: account.email, status: "error", message: `VPS ${account.vps_name}: ${err.message}` };
    }
  });

  const results = await Promise.all(promises);
  res.json(results);
});

/**
 * @swagger
 * /api/accounts/upload:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Upload cookie zip từ máy local (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [email, cookies]
 *             properties:
 *               email:
 *                 type: string
 *               cookies:
 *                 type: string
 *                 format: binary
 */
router.post("/upload", authMiddleware, adminOnly, uploadZip.single("cookies"), (req, res) => {
  const { email } = req.body;
  if (!email || !req.file) {
    return res.status(400).json({ error: "Email và file zip cookie là bắt buộc" });
  }
  if (!SAFE_EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Email không hợp lệ" });
  }

  const cookieDir = path.join(COOKIES_DIR, email);

  try {
    // Extract zip to cookies/<email>/
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    // Detect if zip contains a subfolder wrapping everything
    // e.g. "email@gmail.com/Default/..." → strip top-level folder
    let stripPrefix = "";
    if (entries.length > 0) {
      const firstEntry = entries[0].entryName;
      const topFolder = firstEntry.split("/")[0];
      const allInFolder = entries.every((e) => e.entryName.startsWith(topFolder + "/"));
      if (allInFolder && entries.some((e) => e.isDirectory && e.entryName === topFolder + "/")) {
        stripPrefix = topFolder + "/";
      }
    }

    // Create target dir
    fs.mkdirSync(cookieDir, { recursive: true });

    // Skip browser cache folders that are large and unnecessary
    const SKIP_PATTERNS = [
      /^Cache\//i,
      /^Code Cache\//i,
      /^GPUCache\//i,
      /^DawnWebGPUCache\//i,
      /^DawnGraphiteCache\//i,
      /^GrShaderCache\//i,
      /^GraphiteDawnCache\//i,
      /^ShaderCache\//i,
      /^BrowserMetrics\//i,
      /^DeferredBrowserMetrics\//i,
      /^Crashpad\//i,
      /^Safe Browsing\//i,
      /^component_crx_cache\//i,
      /^extensions_crx_cache\//i,
      /^segmentation_platform\//i,
      /^Default\/Cache\//i,
      /^Default\/Code Cache\//i,
      /^Default\/GPUCache\//i,
      /^Default\/DawnWebGPUCache\//i,
      /^Default\/DawnGraphiteCache\//i,
      /^Default\/Service Worker\//i,
    ];

    // Extract entries (skip cache)
    let extracted = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      let targetPath = entry.entryName;
      if (stripPrefix && targetPath.startsWith(stripPrefix)) {
        targetPath = targetPath.slice(stripPrefix.length);
      }
      if (!targetPath) continue;

      // Skip cache folders
      if (SKIP_PATTERNS.some((p) => p.test(targetPath))) {
        skipped++;
        continue;
      }

      const fullPath = path.join(cookieDir, targetPath);
      // Security: prevent path traversal
      if (!fullPath.startsWith(cookieDir)) continue;

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, entry.getData());
      extracted++;
    }

    console.log(`[Upload cookies] ${email}: ${extracted} files extracted, ${skipped} cache files skipped`);

    // Create or update account in DB
    const existing = db.prepare("SELECT id FROM gemini_accounts WHERE email = ?").get(email);
    if (existing) {
      db.prepare("UPDATE gemini_accounts SET cookie_dir = ?, status = 'free' WHERE id = ?").run(
        `cookies/${email}`,
        existing.id
      );
      res.json({ ok: true, id: existing.id, message: "Cookie cập nhật thành công" });
    } else {
      const info = db
        .prepare("INSERT INTO gemini_accounts (email, cookie_dir, user_id) VALUES (?, ?, ?)")
        .run(email, `cookies/${email}`, req.user.id);
      res.status(201).json({ ok: true, id: info.lastInsertRowid, message: "Tài khoản tạo thành công" });
    }
  } catch (err) {
    console.error("[Upload cookies]", err);
    res.status(500).json({ error: `Lỗi xử lý file: ${err.message}` });
  }
});

/**
 * @swagger
 * /api/accounts/setup-login:
 *   post:
 *     tags: [Gemini Accounts]
 *     summary: Mở browser để đăng nhập Gemini, tự lưu cookie khi xong
 *     security:
 *       - bearerAuth: []
 */
router.post("/setup-login", authMiddleware, adminOnly, (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: "Email là bắt buộc" });
  }

  const sanitizedEmail = email.trim().replace(/[^a-zA-Z0-9@._-]/g, "");
  if (sanitizedEmail !== email.trim()) {
    return res.status(400).json({ error: "Email chứa ký tự không hợp lệ" });
  }

  const cookieDir = `cookies/${sanitizedEmail}`;

  // Pre-create or mark account as "logging_in" immediately so frontend can poll
  const existing = db.prepare("SELECT id FROM gemini_accounts WHERE email = ?").get(sanitizedEmail);
  if (existing) {
    db.prepare("UPDATE gemini_accounts SET status = 'disabled' WHERE id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO gemini_accounts (email, cookie_dir, status, user_id) VALUES (?, ?, 'disabled', ?)").run(
      sanitizedEmail,
      cookieDir,
      req.user.id
    );
  }

  // Run setup_account.py in background
  const child = spawn(PYTHON, [SETUP_SCRIPT, sanitizedEmail], {
    cwd: path.resolve(__dirname, "../../../"),
    timeout: 360_000, // 6 minutes max
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", DISPLAY: process.env.DISPLAY || ":0" },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
    console.log(`[setup-login][stdout] ${d.toString().trim()}`);
  });
  child.stderr.on("data", (d) => {
    stderr += d;
    console.error(`[setup-login][stderr] ${d.toString().trim()}`);
  });

  // Respond immediately — browser opens in background
  res.json({
    ok: true,
    message: `Browser đang mở. Hãy đăng nhập Google với ${sanitizedEmail}. Cookie sẽ tự động lưu khi Gemini load xong.`,
  });

  // When script finishes, update account status
  child.on("close", (code) => {
    console.log(`[setup-login] Process exited with code ${code} for ${sanitizedEmail}`);
    if (code === 0) {
      db.prepare("UPDATE gemini_accounts SET cookie_dir = ?, status = 'free' WHERE email = ?").run(
        cookieDir,
        sanitizedEmail
      );
      console.log(`[setup-login] Account ${sanitizedEmail} → free`);

      // Auto-sync cookies to assigned VPS (if any)
      const account = db.prepare("SELECT vps_id FROM gemini_accounts WHERE email = ?").get(sanitizedEmail);
      if (account?.vps_id) {
        const vpsNode = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(account.vps_id);
        if (vpsNode) {
          const baseUrl = vpsNode.host.startsWith("http") ? vpsNode.host.replace(/\/+$/, "") : `http://${vpsNode.host}:${vpsNode.port}`;
          fetch(`${baseUrl}/agent/cookies/sync`, {
            method: "POST",
            headers: { "X-Api-Key": vpsNode.secret_key, "Content-Type": "application/json" },
            body: JSON.stringify({ emails: [sanitizedEmail] }),
            signal: AbortSignal.timeout(120_000),
          })
            .then((r) => r.json())
            .then((data) => console.log(`[setup-login] Cookie sync to ${vpsNode.name}: ${JSON.stringify(data.results)}`))
            .catch((err) => console.warn(`[setup-login] Cookie sync failed: ${err.message}`));
        }
      }
    } else {
      console.error(`[setup-login] Failed for ${sanitizedEmail}: ${stderr || stdout}`);
      // Keep as disabled so user can see it failed
    }
  });

  child.on("error", (err) => {
    console.error(`[setup-login] Spawn error: ${err.message}`);
  });
});

module.exports = router;
