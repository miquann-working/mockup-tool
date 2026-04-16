require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const rateLimit = require("express-rate-limit");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const db = require("./db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const promptRoutes = require("./routes/prompts");
const promptGroupRoutes = require("./routes/prompt-groups");
const accountRoutes = require("./routes/accounts");
const jobRoutes = require("./routes/jobs");
const settingRoutes = require("./routes/settings");
const vpsRoutes = require("./routes/vps");

const app = express();
const PORT = process.env.PORT || 4000;

// Swagger setup
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Mockup Tool API",
      version: "1.0.0",
      description: "Internal mockup generation tool API",
    },
    servers: [{ url: `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: [path.join(__dirname, "./routes/*.js")],
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim())
    : ["http://localhost:3000"],
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Serve uploaded & output files
app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
app.use("/outputs", express.static(path.join(__dirname, "../../outputs")));

// HD upscale endpoint — upscales output images on-the-fly
app.get("/outputs-hd/:filename", async (req, res) => {
  const filename = path.basename(req.params.filename); // sanitize
  const filePath = path.join(__dirname, "../../outputs", filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  const size = parseInt(req.query.size) || 2048;
  const clampedSize = Math.min(Math.max(size, 1024), 4096);

  try {
    const ext = path.extname(filename).toLowerCase();
    const buffer = await sharp(filePath)
      .resize(clampedSize, clampedSize, { kernel: sharp.kernel.lanczos3, fit: "inside", withoutEnlargement: false })
      .toFormat(ext === ".png" ? "png" : "jpeg", ext === ".png" ? { compressionLevel: 6 } : { quality: 95 })
      .toBuffer();

    const hdName = filename.replace(/(\.[^.]+)$/, `_${clampedSize}$1`);
    res.setHeader("Content-Type", ext === ".png" ? "image/png" : "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${hdName}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[Upscale] Error:", err.message);
    res.status(500).json({ error: "Upscale failed" });
  }
});

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 20, // 20 lần login / 15 phút / IP
  message: { error: "Quá nhiều lần đăng nhập, vui lòng thử lại sau 15 phút" },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 200, // 200 request / phút / IP
  message: { error: "Quá nhiều request, vui lòng thử lại sau" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use("/api/auth", loginLimiter, authRoutes);
app.use("/api/users", apiLimiter, userRoutes);
app.use("/api/prompts", apiLimiter, promptRoutes);
app.use("/api/prompt-groups", apiLimiter, promptGroupRoutes);
app.use("/api/accounts", apiLimiter, accountRoutes);
app.use("/api/jobs", apiLimiter, jobRoutes);
app.use("/api/settings", apiLimiter, settingRoutes);
app.use("/api/vps", vpsRoutes); // VPS callbacks need no rate limit

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
