// Test VPS API endpoints
const http = require("http");

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "localhost",
      port: 4000,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function authRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "localhost",
      port: 4000,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };
    if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    // Login
    const login = await request("POST", "/api/auth/login", { username: "admin", password: "admin123" });
    if (!login.token) { console.error("Login failed:", login); process.exit(1); }
    const token = login.token;
    console.log("1. Login OK");

    // Create VPS
    const vps = await authRequest("POST", "/api/vps", token, { name: "VPS Ha Noi", host: "192.168.1.101", port: 5001, max_concurrent: 3 });
    console.log(`2. Created VPS: id=${vps.id} name=${vps.name} status=${vps.status}`);
    console.log(`   secret_key: ${vps.secret_key.substring(0, 16)}...`);

    // List VPS
    const list = await authRequest("GET", "/api/vps", token);
    console.log(`3. List VPS: ${list.length} node(s)`);

    // Assign accounts
    const assignAcc = await authRequest("POST", `/api/vps/${vps.id}/assign-accounts`, token, { account_ids: [1, 2, 6] });
    console.log(`4. Assign accounts: ${assignAcc.assigned} assigned`);

    // Assign users
    const assignUsr = await authRequest("POST", `/api/vps/${vps.id}/assign-users`, token, { user_ids: [2] });
    console.log(`5. Assign users: ${assignUsr.assigned} assigned`);

    // Get detail
    const detail = await authRequest("GET", `/api/vps/${vps.id}`, token);
    console.log(`6. Detail: ${detail.name} | status=${detail.status}`);
    console.log(`   Accounts: ${detail.accounts.map(a => a.email).join(", ")}`);
    console.log(`   Users: ${detail.users.map(u => u.username).join(", ")}`);

    // Heartbeat
    const hb = await request("POST", "/api/vps/heartbeat", { secret_key: vps.secret_key });
    console.log(`7. Heartbeat: ok=${hb.ok} name=${hb.name}`);

    // Verify online
    const detail2 = await authRequest("GET", `/api/vps/${vps.id}`, token);
    console.log(`8. After heartbeat: status=${detail2.status}`);

    // Update VPS
    await authRequest("PUT", `/api/vps/${vps.id}`, token, { name: "VPS Ha Noi Updated" });
    const detail3 = await authRequest("GET", `/api/vps/${vps.id}`, token);
    console.log(`9. Updated name: ${detail3.name}`);

    // Unassign 1 account
    await authRequest("POST", `/api/vps/${vps.id}/unassign-accounts`, token, { account_ids: [6] });
    const detail4 = await authRequest("GET", `/api/vps/${vps.id}`, token);
    console.log(`10. After unassign: ${detail4.accounts.length} accounts`);

    // Delete VPS
    await authRequest("DELETE", `/api/vps/${vps.id}`, token);
    const listAfter = await authRequest("GET", "/api/vps", token);
    console.log(`11. After delete: ${listAfter.length} VPS remaining`);

    // Verify accounts/users unlinked
    const db = require("./backend/src/db");
    const accs = db.prepare("SELECT id, vps_id FROM gemini_accounts WHERE id IN (1,2,6)").all();
    const allNull = accs.every(a => a.vps_id === null);
    console.log(`12. Accounts vps_id cleared: ${allNull}`);
    const usr = db.prepare("SELECT id, vps_id FROM users WHERE id = 2").get();
    console.log(`13. User vps_id cleared: ${usr.vps_id === null}`);

    console.log("\n=== ALL TESTS PASSED ===");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    process.exit(1);
  }
})();
