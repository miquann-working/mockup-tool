const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { enqueueJob } = require("../services/jobRunner");

const router = Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, "../../../uploads"),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     tags: [Jobs]
 *     summary: Tạo jobs (upload 1 ảnh + chọn chủ đề → tạo jobs cho tất cả prompts trong chủ đề)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image, group_id]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Ảnh gốc (max 20MB)
 *               group_id:
 *                 type: integer
 *                 description: ID chủ đề prompt
 *               prompt_id:
 *                 type: integer
 *                 description: ID prompt đơn lẻ (backward compat)
 *               prompt_ids:
 *                 type: string
 *                 description: Danh sách prompt IDs, ngăn bởi dấu phẩy (backward compat)
 *     responses:
 *       201:
 *         description: Mảng jobs đã tạo
 *       404:
 *         description: Group hoặc Prompt không tồn tại
 */
router.post("/", authMiddleware, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file required" });

  let promptIds = [];

  // Priority: group_id > prompt_ids > prompt_id
  if (req.body.group_id) {
    const groupId = Number(req.body.group_id);
    console.log(`[Jobs POST] group_id=${groupId}`);
    const group = db.prepare("SELECT id FROM prompt_groups WHERE id = ?").get(groupId);
    if (!group) {
      return res.status(404).json({ error: "Prompt group not found" });
    }
    const prompts = db.prepare("SELECT id FROM prompts WHERE group_id = ? ORDER BY id ASC").all(groupId);
    if (prompts.length === 0) {
      return res.status(400).json({ error: "Group has no prompts" });
    }
    promptIds = prompts.map((p) => p.id);
  } else if (req.body.prompt_ids) {
    promptIds = String(req.body.prompt_ids)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
  } else if (req.body.prompt_id) {
    promptIds = [Number(req.body.prompt_id)];
  }

  if (promptIds.length === 0) {
    return res.status(400).json({ error: "group_id or prompt_id(s) required" });
  }

  // Verify all prompts exist
  const checkPrompt = db.prepare("SELECT id FROM prompts WHERE id = ?");
  for (const pid of promptIds) {
    if (!checkPrompt.get(pid)) {
      return res.status(404).json({ error: `Prompt ${pid} not found` });
    }
  }

  const batchId = promptIds.length > 1 ? uuidv4() : null;
  const insertJob = db.prepare(
    "INSERT INTO jobs (batch_id, user_id, prompt_id, original_image) VALUES (?, ?, ?, ?)"
  );

  const createdJobs = db.transaction(() => {
    const results = [];
    for (const pid of promptIds) {
      const info = insertJob.run(batchId, req.user.id, pid, req.file.filename);
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(info.lastInsertRowid);
      results.push(job);
    }
    return results;
  })();

  // Kick off async processing for each job
  for (const job of createdJobs) {
    enqueueJob(job.id);
  }

  res.status(201).json(createdJobs);
});

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     tags: [Jobs]
 *     summary: Lịch sử jobs (user thấy của mình, admin thấy tất cả)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mảng jobs
 */
router.get("/", authMiddleware, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  let where = "";
  const params = [];

  if (req.user.role !== "admin") {
    where = "WHERE jobs.user_id = ?";
    params.push(req.user.id);
  } else {
    // Admin filters
    if (req.query.role === "mockup" || req.query.role === "trade") {
      where = "WHERE users.role = ?";
      params.push(req.query.role);
    }
    if (req.query.status) {
      where += (where ? " AND" : "WHERE") + " jobs.status = ?";
      params.push(req.query.status);
    }
  }

  // Paginate by batch (batch_id group counts as 1, single job counts as 1)
  const countJoin = req.user.role === "admin" ? "FROM jobs LEFT JOIN users ON jobs.user_id = users.id" : "FROM jobs";
  const totalBatches = db
    .prepare(`SELECT COUNT(DISTINCT COALESCE(jobs.batch_id, 'single_' || jobs.id)) as count ${countJoin} ${where}`)
    .get(...params).count;

  // Get batch keys for this page
  const batchKeysQuery = db
    .prepare(`SELECT COALESCE(jobs.batch_id, 'single_' || jobs.id) as batch_key, MAX(jobs.id) as max_id ${countJoin} ${where} GROUP BY batch_key ORDER BY max_id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const batchKeys = batchKeysQuery.map((r) => r.batch_key);

  let jobs = [];
  if (batchKeys.length > 0) {
    const baseSelect = req.user.role === "admin"
      ? "SELECT jobs.*, users.username, prompts.name as prompt_name, prompts.mode as prompt_mode, prompt_groups.role as group_role FROM jobs LEFT JOIN users ON jobs.user_id = users.id LEFT JOIN prompts ON jobs.prompt_id = prompts.id LEFT JOIN prompt_groups ON prompts.group_id = prompt_groups.id"
      : "SELECT jobs.*, prompts.name as prompt_name, prompts.mode as prompt_mode, prompt_groups.role as group_role FROM jobs LEFT JOIN prompts ON jobs.prompt_id = prompts.id LEFT JOIN prompt_groups ON prompts.group_id = prompt_groups.id";

    const placeholders = batchKeys.map(() => "?").join(",");
    const batchWhere = where
      ? `${where} AND COALESCE(jobs.batch_id, 'single_' || jobs.id) IN (${placeholders})`
      : `WHERE COALESCE(jobs.batch_id, 'single_' || jobs.id) IN (${placeholders})`;

    jobs = db
      .prepare(`${baseSelect} ${batchWhere} ORDER BY jobs.id DESC`)
      .all(...params, ...batchKeys);
  }

  res.json({
    data: jobs,
    pagination: { page, limit, total: totalBatches, totalPages: Math.ceil(totalBatches / limit) },
  });
});

// ── Admin stats ─────────────────────────────────────────────
router.get("/admin/stats", authMiddleware, adminOnly, (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'admin'").get().c;
  const mockupUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'mockup'").get().c;
  const tradeUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'trade'").get().c;

  const totalJobs = db.prepare("SELECT COUNT(*) as c FROM jobs").get().c;
  const todayJobs = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE date(created_at) = ?").get(today).c;
  const pendingJobs = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('pending','processing')").get().c;
  const errorJobs = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'error'").get().c;

  const freeAccounts = db.prepare("SELECT COUNT(*) as c FROM gemini_accounts WHERE status = 'free'").get().c;
  const busyAccounts = db.prepare("SELECT COUNT(*) as c FROM gemini_accounts WHERE status = 'busy'").get().c;
  const totalAccounts = db.prepare("SELECT COUNT(*) as c FROM gemini_accounts").get().c;
  const disabledAccounts = db.prepare("SELECT COUNT(*) as c FROM gemini_accounts WHERE status = 'disabled'").get().c;

  res.json({
    users: { total: totalUsers, mockup: mockupUsers, trade: tradeUsers },
    jobs: { total: totalJobs, today: todayJobs, pending: pendingJobs, error: errorJobs },
    accounts: { total: totalAccounts, free: freeAccounts, busy: busyAccounts, disabled: disabledAccounts },
  });
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     tags: [Jobs]
 *     summary: Chi tiết 1 job
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Chi tiết job
 *       404:
 *         description: Job không tồn tại
 */
router.get("/:id", authMiddleware, (req, res) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (req.user.role !== "admin" && job.user_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  res.json(job);
});

/**
 * @swagger
 * /api/jobs/{id}/retry:
 *   post:
 *     tags: [Jobs]
 *     summary: Retry job lỗi
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Job đã được retry
 *       400:
 *         description: Chỉ retry job status=error
 */
router.post("/:id/retry", authMiddleware, (req, res) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (req.user.role !== "admin" && job.user_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  if (job.status !== "error") {
    return res.status(400).json({ error: "Can only retry failed jobs" });
  }

  // If this job belongs to a batch, retry ALL error jobs in the batch together
  if (job.batch_id) {
    const batchErrorJobs = db
      .prepare("SELECT id FROM jobs WHERE batch_id = ? AND status = 'error' ORDER BY id ASC")
      .all(job.batch_id);
    for (const ej of batchErrorJobs) {
      db.prepare(
        "UPDATE jobs SET status = 'pending', error = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(ej.id);
    }
    // Enqueue all batch jobs so they run together in one conversation
    for (const ej of batchErrorJobs) {
      enqueueJob(ej.id);
    }
    console.log(`[Retry] Batch ${job.batch_id}: retrying ${batchErrorJobs.length} error jobs together`);
  } else {
    db.prepare(
      "UPDATE jobs SET status = 'pending', error = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(job.id);
    enqueueJob(job.id);
  }

  res.json({ ok: true });
});

module.exports = router;
