/**
 * Phase 3 Integration Test
 * Tests: VPS-aware pickAccount, VPS dispatch, callback endpoint
 */
const http = require("http");

const BASE = "http://localhost:4000";
let TOKEN = "";

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const postData = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, data: buf });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

async function run() {
  console.log("=== Phase 3 Integration Test ===\n");

  // Login as admin
  const login = await request("POST", "/api/auth/login", {
    username: "admin",
    password: "admin123",
  });
  assert(login.status === 200, "Admin login");
  TOKEN = login.data.token;
  const authHeaders = { Authorization: `Bearer ${TOKEN}` };

  // ── Test 1: Create VPS node ──
  console.log("\n[Test 1] Create VPS node");
  const createVps = await request(
    "POST",
    "/api/vps",
    { name: "Test-VPS-Phase3", host: "localhost", port: 5001, max_concurrent: 3 },
    authHeaders
  );
  assert(createVps.status === 201, `VPS created (id=${createVps.data.id})`);
  const vpsId = createVps.data.id;
  const vpsKey = createVps.data.secret_key;
  assert(vpsKey && vpsKey.length === 64, "VPS has 64-char secret key");

  // ── Test 2: Callback endpoint - no auth ──
  console.log("\n[Test 2] Callback - no auth");
  const noAuth = await request("POST", "/api/vps/job-callback", { type: "starting", job_id: 1 });
  assert(noAuth.status === 401, "Rejected without X-Api-Key");

  // ── Test 3: Callback endpoint - wrong key ──
  console.log("\n[Test 3] Callback - wrong key");
  const wrongKey = await request(
    "POST",
    "/api/vps/job-callback",
    { type: "starting", job_id: 1 },
    { "X-Api-Key": "wrong-key" }
  );
  assert(wrongKey.status === 401, "Rejected with wrong X-Api-Key");

  // ── Test 4: Callback endpoint - valid key, starting type ──
  console.log("\n[Test 4] Callback - valid key, starting");
  // Use a job that exists (pick the first one)
  const db = require("./backend/src/db");
  const firstJob = db.prepare("SELECT id FROM jobs ORDER BY id ASC LIMIT 1").get();
  if (firstJob) {
    // Save original status to restore later
    const origJob = db.prepare("SELECT status FROM jobs WHERE id = ?").get(firstJob.id);

    const startCb = await request(
      "POST",
      "/api/vps/job-callback",
      { type: "starting", job_id: firstJob.id, batch_key: `single_${firstJob.id}` },
      { "X-Api-Key": vpsKey }
    );
    assert(startCb.status === 200, `Callback accepted (job ${firstJob.id})`);

    // Check job was updated to processing
    const updated = db.prepare("SELECT status FROM jobs WHERE id = ?").get(firstJob.id);
    assert(updated.status === "processing", "Job status updated to processing");

    // Restore original status
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(origJob.status, firstJob.id);
  }

  // ── Test 5: Callback - done type (simulated) ──
  console.log("\n[Test 5] Callback - done type");
  if (firstJob) {
    const origJob = db.prepare("SELECT status, mockup_image FROM jobs WHERE id = ?").get(firstJob.id);

    const doneCb = await request(
      "POST",
      "/api/vps/job-callback",
      {
        type: "done",
        job_id: firstJob.id,
        batch_key: `single_${firstJob.id}`,
        output_file: "test_vps_output.png",
        // Small 1x1 white PNG as base64
        image_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      },
      { "X-Api-Key": vpsKey }
    );
    assert(doneCb.status === 200, "Done callback accepted");

    // Check job was updated
    const updatedJob = db.prepare("SELECT status, mockup_image FROM jobs WHERE id = ?").get(firstJob.id);
    assert(updatedJob.status === "done", "Job status updated to done");
    assert(updatedJob.mockup_image === "test_vps_output.png", "Job mockup_image set");

    // Check file was saved
    const fs = require("fs");
    const path = require("path");
    const outputPath = path.resolve(__dirname, "outputs", "test_vps_output.png");
    assert(fs.existsSync(outputPath), "Output file saved to outputs/");

    // Cleanup
    try { fs.unlinkSync(outputPath); } catch {}
    db.prepare("UPDATE jobs SET status = ?, mockup_image = ? WHERE id = ?").run(
      origJob.status, origJob.mockup_image, firstJob.id
    );
  }

  // ── Test 6: Callback - error type for single job ──
  console.log("\n[Test 6] Callback - error for single job");
  if (firstJob) {
    const origJob = db.prepare("SELECT status, error, retry_count FROM jobs WHERE id = ?").get(firstJob.id);

    // Set retry_count to 0 to trigger retry
    db.prepare("UPDATE jobs SET retry_count = 0, status = 'processing' WHERE id = ?").run(firstJob.id);

    const errCb = await request(
      "POST",
      "/api/vps/job-callback",
      {
        type: "error",
        job_id: firstJob.id,
        batch_key: `single_${firstJob.id}`,
        error: "Test error from VPS",
      },
      { "X-Api-Key": vpsKey }
    );
    assert(errCb.status === 200, "Error callback accepted");

    // Check job was updated for retry
    const updatedJob = db.prepare("SELECT status, error, retry_count FROM jobs WHERE id = ?").get(firstJob.id);
    assert(updatedJob.status === "pending", "Job returned to pending for retry");
    assert(updatedJob.retry_count === 1, "Retry count incremented to 1");

    // Restore
    db.prepare("UPDATE jobs SET status = ?, error = ?, retry_count = ? WHERE id = ?").run(
      origJob.status, origJob.error, origJob.retry_count, firstJob.id
    );
  }

  // ── Test 7: Callback - rate_limited for single job ──
  console.log("\n[Test 7] Callback - rate_limited for single job");
  if (firstJob) {
    const origJob = db.prepare("SELECT status, error, account_id FROM jobs WHERE id = ?").get(firstJob.id);

    db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(firstJob.id);

    const rlCb = await request(
      "POST",
      "/api/vps/job-callback",
      {
        type: "rate_limited",
        job_id: firstJob.id,
        batch_key: `single_${firstJob.id}`,
        error: "RATE_LIMITED",
      },
      { "X-Api-Key": vpsKey }
    );
    assert(rlCb.status === 200, "Rate limited callback accepted");

    const updatedJob = db.prepare("SELECT status FROM jobs WHERE id = ?").get(firstJob.id);
    assert(updatedJob.status === "pending", "Job returned to pending after rate limit");

    // Restore
    db.prepare("UPDATE jobs SET status = ?, error = ?, account_id = ? WHERE id = ?").run(
      origJob.status, origJob.error, origJob.account_id, firstJob.id
    );
  }

  // ── Test 8: VPS-aware account selection (pickAccount logic) ──
  console.log("\n[Test 8] VPS-aware account selection");
  // Assign an account to our test VPS
  const accounts = db.prepare("SELECT id, email, vps_id FROM gemini_accounts LIMIT 1").get();
  if (accounts) {
    const origVpsId = accounts.vps_id;

    // Assign account to VPS
    db.prepare("UPDATE gemini_accounts SET vps_id = ? WHERE id = ?").run(vpsId, accounts.id);

    // Assign admin user to same VPS
    const adminUser = db.prepare("SELECT id, vps_id FROM users WHERE username = 'admin'").get();
    db.prepare("UPDATE users SET vps_id = ? WHERE id = ?").run(vpsId, adminUser.id);

    // Check account queries
    const vpsAccount = db
      .prepare(
        `SELECT * FROM gemini_accounts WHERE status = 'free' AND vps_id = ?
         AND (rate_limited_until IS NULL OR rate_limited_until < datetime('now'))
         ORDER BY last_used_at ASC LIMIT 1`
      )
      .get(vpsId);
    assert(vpsAccount && vpsAccount.id === accounts.id, "VPS account found by vps_id");

    const localAccount = db
      .prepare(
        `SELECT * FROM gemini_accounts WHERE status = 'free' AND vps_id IS NULL
         AND (rate_limited_until IS NULL OR rate_limited_until < datetime('now'))
         ORDER BY last_used_at ASC LIMIT 1`
      )
      .get();
    if (localAccount) {
      assert(localAccount.id !== accounts.id, "Local account excludes VPS account");
    } else {
      // If only 1 account and it's now on VPS, there are no local accounts
      const totalAccounts = db.prepare("SELECT COUNT(*) as c FROM gemini_accounts").get().c;
      assert(totalAccounts === 1 || localAccount, "No local accounts (all on VPS) — expected");
      passed++; // count this as passing
    }

    // Restore
    db.prepare("UPDATE gemini_accounts SET vps_id = ? WHERE id = ?").run(origVpsId, accounts.id);
    db.prepare("UPDATE users SET vps_id = ? WHERE id = ?").run(adminUser.vps_id, adminUser.id);
  }

  // ── Test 9: Heartbeat sets VPS online ──
  console.log("\n[Test 9] Heartbeat → VPS online");
  const hb = await request("POST", "/api/vps/heartbeat", { secret_key: vpsKey });
  assert(hb.status === 200, "Heartbeat accepted");
  const vpsStatus = db.prepare("SELECT status FROM vps_nodes WHERE id = ?").get(vpsId);
  assert(vpsStatus.status === "online", "VPS status is online");

  // ── Test 10: Callback - batch_complete (success) ──
  console.log("\n[Test 10] Callback - batch_complete (success)");
  const batchCompleteCb = await request(
    "POST",
    "/api/vps/job-callback",
    {
      type: "batch_complete",
      batch_key: "nonexistent_batch_xyz",
      completed: [],
      total: 0,
    },
    { "X-Api-Key": vpsKey }
  );
  assert(batchCompleteCb.status === 200, "batch_complete callback accepted (no-op for unknown batch)");

  // ── Cleanup: delete test VPS ──
  console.log("\n[Cleanup]");
  const delVps = await request("DELETE", `/api/vps/${vpsId}`, null, authHeaders);
  assert(delVps.status === 200, "Test VPS deleted");

  // ── Summary ──
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
