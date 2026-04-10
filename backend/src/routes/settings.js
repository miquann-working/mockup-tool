const { Router } = require("express");
const db = require("../db");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = Router();

/**
 * @swagger
 * /api/settings:
 *   get:
 *     tags: [Settings]
 *     summary: Lấy tất cả settings (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Object key-value settings
 */
router.get("/", authMiddleware, adminOnly, (_req, res) => {
  const rows = db.prepare("SELECT * FROM settings").all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

/**
 * @swagger
 * /api/settings:
 *   put:
 *     tags: [Settings]
 *     summary: Cập nhật settings (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example:
 *               line_drawing_prompt: "Convert this mockup..."
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put("/", authMiddleware, adminOnly, (req, res) => {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) {
      upsert.run(k, String(v));
    }
  });
  tx(Object.entries(req.body));
  res.json({ ok: true });
});

module.exports = router;
