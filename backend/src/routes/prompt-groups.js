const { Router } = require("express");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = Router();

/**
 * @swagger
 * /api/prompt-groups:
 *   get:
 *     tags: [Prompt Groups]
 *     summary: Lấy danh sách chủ đề (kèm prompts). Hỗ trợ phân trang, tìm kiếm, lọc user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Tìm theo tên chủ đề
 *       - in: query
 *         name: user_id
 *         schema: { type: integer }
 *         description: Lọc theo user (admin only)
 *     responses:
 *       200:
 *         description: Kết quả phân trang
 */
router.get("/", authMiddleware, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search}%` : null;
  const filterUserId = req.query.user_id ? Number(req.query.user_id) : null;

  let where = "WHERE 1=1";
  const params = [];

  // Role-based filter: mockup users see only mockup groups, trade users see only trade groups, admin sees all
  if (req.user.role !== "admin") {
    const userRole = req.user.role === "trade" ? "trade" : "mockup";
    where += " AND pg.role = ?";
    params.push(userRole);
  } else if (req.query.role) {
    where += " AND pg.role = ?";
    params.push(req.query.role);
  }

  if (search) {
    where += " AND pg.name LIKE ?";
    params.push(search);
  }
  if (filterUserId && Number.isInteger(filterUserId) && filterUserId > 0) {
    where += " AND pg.user_id = ?";
    params.push(filterUserId);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM prompt_groups pg ${where}`)
    .get(...params).count;

  const groups = db
    .prepare(
      `SELECT pg.*, u.username as owner_name
       FROM prompt_groups pg
       LEFT JOIN users u ON pg.user_id = u.id
       ${where}
       ORDER BY pg.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const groupIds = groups.map((g) => g.id);
  let prompts = [];
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => "?").join(",");
    prompts = db
      .prepare(
        `SELECT * FROM prompts WHERE group_id IN (${placeholders}) ORDER BY id ASC`
      )
      .all(...groupIds);
  }

  const data = groups.map((g) => ({
    ...g,
    prompts: prompts.filter((p) => p.group_id === g.id),
  }));

  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * @swagger
 * /api/prompt-groups:
 *   post:
 *     tags: [Prompt Groups]
 *     summary: Tạo chủ đề mới với prompts (user tạo của mình, admin tạo global)
 *     security:
 *       - bearerAuth: []
 */
router.post("/", authMiddleware, (req, res) => {
  const { name, prompts } = req.body;
  if (!name || !Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "name and prompts array required" });
  }

  for (const p of prompts) {
    if (!p.name || !p.name.trim()) {
      return res.status(400).json({ error: "Tên prompt không được trống" });
    }
    if (!p.content || !p.content.trim()) {
      return res.status(400).json({ error: "Nội dung prompt không được trống" });
    }
  }

  const result = db.transaction(() => {
    const groupRole = req.user.role === "admin"
      ? (req.body.role === "trade" ? "trade" : "mockup")
      : (req.user.role === "trade" ? "trade" : "mockup");
    const groupInfo = db
      .prepare("INSERT INTO prompt_groups (name, user_id, role) VALUES (?, ?, ?)")
      .run(name.trim(), req.user.id, groupRole);
    const groupId = groupInfo.lastInsertRowid;

    const insertPrompt = db.prepare(
      "INSERT INTO prompts (group_id, name, content, mode) VALUES (?, ?, ?, ?)"
    );
    const createdPrompts = [];
    for (const p of prompts) {
      const mode = p.mode === "line_drawing" ? "line_drawing" : "mockup";
      const info = insertPrompt.run(groupId, p.name, p.content, mode);
      createdPrompts.push({
        id: info.lastInsertRowid,
        name: p.name,
        content: p.content,
        mode,
      });
    }

    return { id: groupId, name, user_id: req.user.id, role: groupRole, prompts: createdPrompts };
  })();

  res.status(201).json(result);
});

/**
 * @swagger
 * /api/prompt-groups/{id}:
 *   put:
 *     tags: [Prompt Groups]
 *     summary: Cập nhật chủ đề + prompts (owner hoặc admin)
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id", authMiddleware, (req, res) => {
  const groupId = Number(req.params.id);
  const { name, prompts } = req.body;
  if (!name || !Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "name and prompts array required" });
  }

  const existing = db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(groupId);
  if (!existing) {
    return res.status(404).json({ error: "Group not found" });
  }

  // Only owner or admin can edit
  if (req.user.role !== "admin" && existing.user_id !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền sửa chủ đề này" });
  }

  db.transaction(() => {
    // Update group name and optional fields
    const groupRole = req.user.role === "admin"
      ? (req.body.role === "trade" ? "trade" : (req.body.role || existing.role || "mockup"))
      : existing.role;
    db.prepare("UPDATE prompt_groups SET name = ?, role = ? WHERE id = ?").run(name, groupRole, groupId);

    // Get existing prompts for this group
    const existingPrompts = db.prepare("SELECT id FROM prompts WHERE group_id = ?").all(groupId);
    const existingIds = new Set(existingPrompts.map((p) => p.id));

    // Track which existing IDs are kept
    const keptIds = new Set();
    const updatePrompt = db.prepare(
      "UPDATE prompts SET name = ?, content = ?, mode = ? WHERE id = ? AND group_id = ?"
    );
    const insertPrompt = db.prepare(
      "INSERT INTO prompts (group_id, name, content, mode) VALUES (?, ?, ?, ?)"
    );

    for (const p of prompts) {
      const mode = p.mode === "line_drawing" ? "line_drawing" : "mockup";
      if (p.id && existingIds.has(p.id)) {
        // Update existing prompt — preserve ID
        updatePrompt.run(p.name, p.content, mode, p.id, groupId);
        keptIds.add(p.id);
      } else {
        // New prompt — insert
        insertPrompt.run(groupId, p.name, p.content, mode);
      }
    }

    // Delete prompts that were removed by user (not in keptIds)
    for (const oldId of existingIds) {
      if (!keptIds.has(oldId)) {
        db.prepare("DELETE FROM prompts WHERE id = ? AND group_id = ?").run(oldId, groupId);
      }
    }
  })();

  res.json({ ok: true });
});

/**
 * @swagger
 * /api/prompt-groups/{id}:
 *   delete:
 *     tags: [Prompt Groups]
 *     summary: Xóa chủ đề và các prompts (owner hoặc admin)
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:id", authMiddleware, (req, res) => {
  const groupId = Number(req.params.id);

  const existing = db.prepare("SELECT * FROM prompt_groups WHERE id = ?").get(groupId);
  if (!existing) {
    return res.status(404).json({ error: "Group not found" });
  }

  // Only owner or admin can delete
  if (req.user.role !== "admin" && existing.user_id !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền xóa chủ đề này" });
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM prompts WHERE group_id = ?").run(groupId);
      db.prepare("DELETE FROM prompt_groups WHERE id = ?").run(groupId);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  res.json({ ok: true });
});

module.exports = router;
