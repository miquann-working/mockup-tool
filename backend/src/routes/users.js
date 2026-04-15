const { Router } = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = Router();

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: Danh sách users (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mảng users
 */
router.get("/", authMiddleware, adminOnly, (_req, res) => {
  const users = db.prepare("SELECT id, username, role, created_at FROM users").all();
  res.json(users);
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Tạo user mới (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *                 default: user
 *     responses:
 *       201:
 *         description: User đã tạo
 *       409:
 *         description: Username đã tồn tại
 */
router.post("/", authMiddleware, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const validRole = role === "admin" ? "admin" : role === "trade" ? "trade" : "mockup";
  const hash = await bcrypt.hash(password, 10);

  try {
    const info = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, hash, validRole);
    res.status(201).json({ id: info.lastInsertRowid, username, role: validRole });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already exists" });
    }
    throw err;
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Xóa user (admin)
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
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

/**
 * @swagger
 * /api/users/{id}/password:
 *   put:
 *     tags: [Users]
 *     summary: Đổi mật khẩu user (admin)
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
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Đổi mật khẩu thành công
 */
router.put("/:id/password", authMiddleware, adminOnly, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await bcrypt.hash(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
