const { Router } = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const tar = require("tar");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { handleVpsCallback } = require("../services/jobRunner");

const COOKIES_DIR = path.resolve(__dirname, "../../../cookies");

const router = Router();

// ── Helper ──────────────────────────────────────────────────

function generateApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

// ── CRUD ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vps:
 *   get:
 *     tags: [VPS Nodes]
 *     summary: Danh sách VPS nodes (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mảng VPS nodes kèm accounts & users
 */
router.get("/", authMiddleware, adminOnly, (_req, res) => {
  const nodes = db.prepare("SELECT * FROM vps_nodes ORDER BY id").all();

  // Attach accounts and users for each VPS
  const stmtAccounts = db.prepare(
    "SELECT id, email, status, last_used_at FROM gemini_accounts WHERE vps_id = ?"
  );
  const stmtUsers = db.prepare(
    "SELECT id, username, role FROM users WHERE vps_id = ?"
  );

  const result = nodes.map((node) => ({
    ...node,
    accounts: stmtAccounts.all(node.id),
    users: stmtUsers.all(node.id),
  }));

  res.json(result);
});

/**
 * @swagger
 * /api/vps/{id}:
 *   get:
 *     tags: [VPS Nodes]
 *     summary: Chi tiết 1 VPS node (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id", authMiddleware, adminOnly, (req, res) => {
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(Number(req.params.id));
  if (!node) return res.status(404).json({ error: "VPS not found" });

  node.accounts = db
    .prepare("SELECT id, email, status, last_used_at FROM gemini_accounts WHERE vps_id = ?")
    .all(node.id);
  node.users = db
    .prepare("SELECT id, username, role FROM users WHERE vps_id = ?")
    .all(node.id);

  res.json(node);
});

/**
 * @swagger
 * /api/vps:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Thêm VPS node mới (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, host]
 *             properties:
 *               name:
 *                 type: string
 *               host:
 *                 type: string
 *               port:
 *                 type: integer
 *                 default: 5001
 *               max_concurrent:
 *                 type: integer
 *                 default: 3
 *     responses:
 *       201:
 *         description: VPS đã tạo (trả về kèm secret_key)
 */
router.post("/", authMiddleware, adminOnly, (req, res) => {
  const { name, host, port, max_concurrent } = req.body;
  if (!name || !host) {
    return res.status(400).json({ error: "name and host are required" });
  }

  const secret_key = generateApiKey();
  const info = db
    .prepare(
      `INSERT INTO vps_nodes (name, host, port, secret_key, max_concurrent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, host, port || 5001, secret_key, max_concurrent || 3);

  res.status(201).json({
    id: info.lastInsertRowid,
    name,
    host,
    port: port || 5001,
    secret_key,
    status: "offline",
    max_concurrent: max_concurrent || 3,
  });
});

/**
 * @swagger
 * /api/vps/{id}:
 *   put:
 *     tags: [VPS Nodes]
 *     summary: Cập nhật VPS node (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id", authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(id);
  if (!node) return res.status(404).json({ error: "VPS not found" });

  const { name, host, port, max_concurrent } = req.body;
  db.prepare(
    `UPDATE vps_nodes SET
       name = COALESCE(?, name),
       host = COALESCE(?, host),
       port = COALESCE(?, port),
       max_concurrent = COALESCE(?, max_concurrent)
     WHERE id = ?`
  ).run(name || null, host || null, port || null, max_concurrent || null, id);

  res.json({ ok: true });
});

/**
 * @swagger
 * /api/vps/{id}:
 *   delete:
 *     tags: [VPS Nodes]
 *     summary: Xóa VPS node (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:id", authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(id);
  if (!node) return res.status(404).json({ error: "VPS not found" });

  // Unlink accounts & users from this VPS before deleting
  db.prepare("UPDATE gemini_accounts SET vps_id = NULL WHERE vps_id = ?").run(id);
  db.prepare("UPDATE users SET vps_id = NULL WHERE vps_id = ?").run(id);
  db.prepare("DELETE FROM vps_nodes WHERE id = ?").run(id);

  res.json({ ok: true });
});

/**
 * @swagger
 * /api/vps/{id}/regenerate-key:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Tạo lại API key cho VPS (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/regenerate-key", authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(id);
  if (!node) return res.status(404).json({ error: "VPS not found" });

  const secret_key = generateApiKey();
  db.prepare("UPDATE vps_nodes SET secret_key = ? WHERE id = ?").run(secret_key, id);

  res.json({ secret_key });
});

// ── Assignment: accounts & users ────────────────────────────

/**
 * @swagger
 * /api/vps/{id}/assign-accounts:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Gán accounts vào VPS (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [account_ids]
 *             properties:
 *               account_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 */
router.post("/:id/assign-accounts", authMiddleware, adminOnly, (req, res) => {
  const vpsId = Number(req.params.id);
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(vpsId);
  if (!node) return res.status(404).json({ error: "VPS not found" });

  const { account_ids } = req.body;
  if (!Array.isArray(account_ids)) {
    return res.status(400).json({ error: "account_ids must be an array" });
  }

  const stmt = db.prepare("UPDATE gemini_accounts SET vps_id = ? WHERE id = ?");
  const assign = db.transaction((ids) => {
    for (const accId of ids) {
      stmt.run(vpsId, accId);
    }
  });
  assign(account_ids);

  // Trigger async cookie sync to VPS agent (fire & forget)
  const accounts = db
    .prepare(`SELECT email FROM gemini_accounts WHERE id IN (${account_ids.map(() => "?").join(",")})`)
    .all(...account_ids);
  const emails = accounts.map((a) => a.email);

  if (emails.length > 0 && node.host) {
    const baseUrl = node.host.startsWith("http") ? node.host.replace(/\/+$/, "") : `http://${node.host}:${node.port}`;
    const syncUrl = `${baseUrl}/agent/cookies/sync`;
    fetch(syncUrl, {
      method: "POST",
      headers: { "X-Api-Key": node.secret_key, "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => r.json())
      .then((data) => console.log(`[VPS ${node.name}] Cookie sync triggered: ${JSON.stringify(data)}`))
      .catch((err) => console.warn(`[VPS ${node.name}] Cookie sync trigger failed: ${err.message}`));
  }

  res.json({ ok: true, assigned: account_ids.length });
});

/**
 * @swagger
 * /api/vps/{id}/unassign-accounts:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Gỡ accounts khỏi VPS (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/unassign-accounts", authMiddleware, adminOnly, (req, res) => {
  const vpsId = Number(req.params.id);
  const { account_ids } = req.body;
  if (!Array.isArray(account_ids)) {
    return res.status(400).json({ error: "account_ids must be an array" });
  }

  const stmt = db.prepare(
    "UPDATE gemini_accounts SET vps_id = NULL WHERE id = ? AND vps_id = ?"
  );
  const unassign = db.transaction((ids) => {
    for (const accId of ids) {
      stmt.run(accId, vpsId);
    }
  });
  unassign(account_ids);

  res.json({ ok: true });
});

/**
 * @swagger
 * /api/vps/{id}/assign-users:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Gán users vào VPS (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_ids]
 *             properties:
 *               user_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 */
router.post("/:id/assign-users", authMiddleware, adminOnly, (req, res) => {
  const vpsId = Number(req.params.id);
  const node = db.prepare("SELECT * FROM vps_nodes WHERE id = ?").get(vpsId);
  if (!node) return res.status(404).json({ error: "VPS not found" });

  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) {
    return res.status(400).json({ error: "user_ids must be an array" });
  }

  const stmt = db.prepare("UPDATE users SET vps_id = ? WHERE id = ?");
  const assign = db.transaction((ids) => {
    for (const uid of ids) {
      stmt.run(vpsId, uid);
    }
  });
  assign(user_ids);

  res.json({ ok: true, assigned: user_ids.length });
});

/**
 * @swagger
 * /api/vps/{id}/unassign-users:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: Gỡ users khỏi VPS (admin only)
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/unassign-users", authMiddleware, adminOnly, (req, res) => {
  const vpsId = Number(req.params.id);
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) {
    return res.status(400).json({ error: "user_ids must be an array" });
  }

  const stmt = db.prepare("UPDATE users SET vps_id = NULL WHERE id = ? AND vps_id = ?");
  const unassign = db.transaction((ids) => {
    for (const uid of ids) {
      stmt.run(uid, vpsId);
    }
  });
  unassign(user_ids);

  res.json({ ok: true });
});

// ── Heartbeat (called by VPS Agent) ────────────────────────

/**
 * @swagger
 * /api/vps/heartbeat:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: VPS Agent gửi heartbeat (xác thực bằng API key)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret_key]
 *             properties:
 *               secret_key:
 *                 type: string
 *     responses:
 *       200:
 *         description: Heartbeat acknowledged
 */
router.post("/heartbeat", (req, res) => {
  const { secret_key } = req.body;
  if (!secret_key) {
    return res.status(401).json({ error: "secret_key required" });
  }

  const node = db
    .prepare("SELECT id, name FROM vps_nodes WHERE secret_key = ?")
    .get(secret_key);
  if (!node) {
    return res.status(401).json({ error: "Invalid secret_key" });
  }

  db.prepare(
    "UPDATE vps_nodes SET status = 'online', last_heartbeat = datetime('now') WHERE id = ?"
  ).run(node.id);

  // Return assigned account emails so agent can auto-sync cookies
  const assignedAccounts = db
    .prepare("SELECT email FROM gemini_accounts WHERE vps_id = ?")
    .all(node.id)
    .map((a) => a.email);

  res.json({ ok: true, vps_id: node.id, name: node.name, accounts: assignedAccounts });
});

// ── Job callback (called by VPS Agent after job completes) ──

/**
 * @swagger
 * /api/vps/cookies-tar/{email}:
 *   get:
 *     tags: [VPS Nodes]
 *     summary: Stream cookie dir as tar archive (auth by X-Api-Key)
 */
router.get("/cookies-tar/:email", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "Missing X-Api-Key" });

  const node = db.prepare("SELECT id FROM vps_nodes WHERE secret_key = ?").get(apiKey);
  if (!node) return res.status(401).json({ error: "Invalid API key" });

  const email = path.basename(req.params.email); // sanitize
  const cookieDir = path.join(COOKIES_DIR, email);
  if (!fs.existsSync(cookieDir)) {
    return res.status(404).json({ error: `Cookie dir not found: ${email}` });
  }

  res.setHeader("Content-Type", "application/x-tar");
  res.setHeader("Content-Disposition", `attachment; filename="${email}.tar"`);

  tar.create({ cwd: COOKIES_DIR, gzip: false }, [email]).pipe(res);
});

/**
 * @swagger
 * /api/vps/job-callback:
 *   post:
 *     tags: [VPS Nodes]
 *     summary: VPS Agent gửi kết quả job (xác thực bằng API key)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [starting, done, error, job_error, batch_error, rate_limited, batch_complete]
 *               job_id:
 *                 type: integer
 *               batch_key:
 *                 type: string
 *               output_file:
 *                 type: string
 *               image_base64:
 *                 type: string
 *               error:
 *                 type: string
 *     responses:
 *       200:
 *         description: Callback acknowledged
 */
router.post("/job-callback", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Missing X-Api-Key" });
  }

  const node = db
    .prepare("SELECT id, name FROM vps_nodes WHERE secret_key = ?")
    .get(apiKey);
  if (!node) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const { type, image_base64, output_file } = req.body;

  // Save base64 image to outputs/ if present
  if (type === "done" && image_base64 && output_file) {
    const safeName = path.basename(output_file);
    const outputPath = path.resolve(__dirname, "../../../outputs", safeName);
    fs.writeFileSync(outputPath, Buffer.from(image_base64, "base64"));
    // Remove base64 from data passed to handler (already saved)
    req.body.image_base64 = null;
  }

  handleVpsCallback(req.body);

  res.json({ ok: true });
});

// ── Offline detection (runs every 60s) ──────────────────────

setInterval(() => {
  // Mark VPS as offline if no heartbeat for 90 seconds
  db.prepare(
    `UPDATE vps_nodes SET status = 'offline'
     WHERE status = 'online'
       AND last_heartbeat < datetime('now', '-90 seconds')`
  ).run();
}, 60_000);

module.exports = router;
