const { Router } = require("express");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = Router();

/**
 * @swagger
 * /api/prompts:
 *   get:
 *     tags: [Prompts]
 *     summary: Lấy danh sách prompts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mảng prompts
 */
router.get("/", authMiddleware, (_req, res) => {
  const prompts = db.prepare("SELECT * FROM prompts ORDER BY id DESC").all();
  res.json(prompts);
});

/**
 * @swagger
 * /api/prompts:
 *   post:
 *     tags: [Prompts]
 *     summary: Tạo prompt mới (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, content]
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Prompt đã tạo
 */
router.post("/", authMiddleware, adminOnly, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: "Name and content required" });
  }
  const info = db.prepare("INSERT INTO prompts (name, content) VALUES (?, ?)").run(name, content);
  res.status(201).json({ id: info.lastInsertRowid, name, content });
});

/**
 * @swagger
 * /api/prompts/{id}:
 *   put:
 *     tags: [Prompts]
 *     summary: Cập nhật prompt (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, content]
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put("/:id", authMiddleware, adminOnly, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: "Name and content required" });
  }
  db.prepare("UPDATE prompts SET name = ?, content = ? WHERE id = ?").run(name, content, Number(req.params.id));
  res.json({ ok: true });
});

/**
 * @swagger
 * /api/prompts/{id}:
 *   delete:
 *     tags: [Prompts]
 *     summary: Xóa prompt (admin)
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
 *         description: Xóa thành công
 */
router.delete("/:id", authMiddleware, adminOnly, (req, res) => {
  db.prepare("DELETE FROM prompts WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
