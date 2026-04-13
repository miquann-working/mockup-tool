require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Serve uploaded & output files
app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
app.use("/outputs", express.static(path.join(__dirname, "../../outputs")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/prompts", promptRoutes);
app.use("/api/prompt-groups", promptGroupRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/vps", vpsRoutes);

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
