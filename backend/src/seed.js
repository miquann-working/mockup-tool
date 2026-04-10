/**
 * Seed script — creates a default admin user if none exists.
 * Run: npm run seed
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("./db");

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123"; // change after first login

const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(ADMIN_USER);
if (existing) {
  console.log("Admin user already exists, skipping seed.");
} else {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run(ADMIN_USER, hash);
  console.log(`Created admin user: ${ADMIN_USER} / ${ADMIN_PASS}`);
}

// Seed a default line drawing prompt setting
const lineSetting = db.prepare("SELECT key FROM settings WHERE key = 'line_drawing_prompt'").get();
if (!lineSetting) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "line_drawing_prompt",
    "Convert this mockup image into a clean black-and-white line drawing suitable for factory production. Keep all outlines crisp and clear, remove colors and textures."
  );
  console.log("Seeded default line_drawing_prompt setting.");
}

console.log("Seed complete.");
