"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

interface GeminiAccount {
  id: number;
  email: string;
  cookie_dir: string;
  status: "free" | "busy" | "cooldown" | "disabled" | "active";
  last_used_at: string | null;
  created_at: string;
  rate_limited_until: string | null;
  vps_id: number | null;
  vps_name: string | null;
}

function formatTime(dt: string | null | undefined) {
  if (!dt) return "";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  return new Date(s).toLocaleString("vi-VN");
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  free: { label: "Sẵn sàng", color: "text-green-700", bg: "bg-green-100", icon: "✓" },
  active: { label: "Sẵn sàng", color: "text-green-700", bg: "bg-green-100", icon: "✓" },
  busy: { label: "Đang dùng", color: "text-blue-700", bg: "bg-blue-100", icon: "⟳" },
  cooldown: { label: "Cooldown", color: "text-amber-700", bg: "bg-amber-100", icon: "⏳" },
  disabled: { label: "Hết session", color: "text-red-700", bg: "bg-red-100", icon: "✗" },
  rate_limited: { label: "Hết lượt tạo ảnh", color: "text-red-700", bg: "bg-red-100", icon: "⛔" },
};

type StatusFilter = "all" | "free" | "busy" | "cooldown" | "disabled" | "rate_limited";

function isRateLimited(a: GeminiAccount): boolean {
  if (!a.rate_limited_until) return false;
  const s = a.rate_limited_until.endsWith("Z") ? a.rate_limited_until : a.rate_limited_until + "Z";
  return new Date(s) > new Date();
}

function getRateLimitRemaining(a: GeminiAccount): string {
  if (!a.rate_limited_until) return "";
  const s = a.rate_limited_until.endsWith("Z") ? a.rate_limited_until : a.rate_limited_until + "Z";
  const until = new Date(s);
  const now = new Date();
  const diffMs = until.getTime() - now.getTime();
  if (diffMs <= 0) return "";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `còn ${hours}h${mins > 0 ? mins + "p" : ""}`;
  return `còn ${mins}p`;
}

function getEffectiveStatus(a: GeminiAccount): string {
  if (isRateLimited(a)) return "rate_limited";
  if (a.status === "active") return "free";
  return a.status;
}

type ModalMode = null | "edit" | "login";

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<GeminiAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editing, setEditing] = useState<GeminiAccount | null>(null);
  const [email, setEmail] = useState("");
  const [cookieDir, setCookieDir] = useState("");
  const [status, setStatus] = useState("free");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<number | "all" | null>(null);
  const [healthResults, setHealthResults] = useState<Record<number, { status: string; message?: string }>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Login states
  const [loginStatus, setLoginStatus] = useState<"idle" | "opening" | "active" | "stopping" | "success" | "error">("idle");
  const [loginVncUrl, setLoginVncUrl] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginAuthCookies, setLoginAuthCookies] = useState(0);

  const fetchAccounts = useCallback(() => {
    api.get("/accounts").then((r) => setAccounts(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Auto-refresh accounts every 30s to pick up status changes (e.g. session expired)
  useEffect(() => {
    const interval = setInterval(() => {
      api.get("/accounts").then((r) => setAccounts(r.data)).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const closeModal = () => {
    setModalMode(null);
    setEditing(null);
    setEmail("");
    setCookieDir("");
    setStatus("free");
    setLoginStatus("idle");
    setLoginVncUrl("");
    setLoginMessage("");
    setLoginAuthCookies(0);
  };

  const openEdit = (a: GeminiAccount) => {
    closeModal();
    setEditing(a);
    setEmail(a.email);
    setCookieDir(a.cookie_dir);
    setStatus(a.status);
    setModalMode("edit");
  };

  const handleSave = async () => {
    if (!email.trim() || !cookieDir.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/accounts/${editing.id}`, { email, cookie_dir: cookieDir, status });
      }
      closeModal();
      fetchAccounts();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Xóa tài khoản này?")) return;
    await api.delete(`/accounts/${id}`);
    fetchAccounts();
  };

  const handleReset = async (id: number) => {
    await api.post(`/accounts/${id}/reset`);
    fetchAccounts();
  };

  const handleHealthCheck = async (id: number) => {
    setChecking(id);
    try {
      const r = await api.post(`/accounts/${id}/health`);
      setHealthResults((prev) => ({ ...prev, [id]: r.data }));
      if (r.data.status === "error") fetchAccounts();
    } catch {
      setHealthResults((prev) => ({ ...prev, [id]: { status: "error", message: "Không thể kiểm tra" } }));
    } finally {
      setChecking(null);
    }
  };

  const handleHealthCheckAll = async () => {
    setChecking("all");
    setHealthResults({});
    try {
      const r = await api.post("/accounts/health-all", {}, { timeout: 120000 });
      const map: Record<number, { status: string; message?: string }> = {};
      for (const item of r.data) {
        map[item.id] = { status: item.status, message: item.message };
      }
      setHealthResults(map);
      fetchAccounts();
    } catch {
      alert("Lỗi kiểm tra sessions");
    } finally {
      setChecking(null);
    }
  };

  // ── Login handlers (via VPS) ──
  const handleRelogin = (account: GeminiAccount) => {
    closeModal();
    setEditing(account);
    setEmail(account.email);
    setModalMode("login");
  };

  const handleLoginStart = async (reset = false) => {
    if (!editing?.vps_id || !email.trim()) return;
    setLoginStatus("opening");
    setLoginMessage("");
    try {
      const r = await api.post(`/vps/${editing.vps_id}/login/start`, {
        email: email.trim(),
        reset,
      });
      setLoginVncUrl(r.data.vnc_url);
      setLoginStatus("active");
      setLoginMessage("Trình duyệt đã mở trên VPS. Hãy đăng nhập Google trong cửa sổ noVNC.");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setLoginMessage(axiosErr.response?.data?.error || "Không thể mở browser trên VPS");
      setLoginStatus("error");
    }
  };

  const handleLoginFinish = async () => {
    if (!editing?.vps_id || !email.trim()) return;
    setLoginStatus("stopping");
    setLoginMessage("Đang dừng trình duyệt và kiểm tra cookies...");
    try {
      const r = await api.post(`/vps/${editing.vps_id}/login/stop`, {
        email: email.trim(),
      });
      if (r.data.ok) {
        setLoginAuthCookies(r.data.auth_cookies || 0);
        setLoginMessage(r.data.message || "Đăng nhập thành công!");
        setLoginStatus("success");
        fetchAccounts();
      } else {
        setLoginMessage(r.data.message || "Đăng nhập thất bại");
        setLoginStatus("error");
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setLoginMessage(axiosErr.response?.data?.error || "Lỗi khi hoàn tất đăng nhập");
      setLoginStatus("error");
    }
  };

  // ── Filter logic ──
  const filteredAccounts = accounts.filter((a) => {
    if (statusFilter === "all") return true;
    const eff = getEffectiveStatus(a);
    return eff === statusFilter;
  });

  const freeCount = accounts.filter((a) => (a.status === "free" || a.status === "active") && !isRateLimited(a)).length;
  const disabledCount = accounts.filter((a) => a.status === "disabled").length;
  const rateLimitedCount = accounts.filter((a) => isRateLimited(a)).length;
  const busyCount = accounts.filter((a) => a.status === "busy").length;

  const filterButtons: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "Tất cả", count: accounts.length },
    { key: "free", label: "Sẵn sàng", count: freeCount },
    { key: "busy", label: "Đang dùng", count: busyCount },
    { key: "disabled", label: "Hết session", count: disabledCount },
    { key: "rate_limited", label: "Hết lượt", count: rateLimitedCount },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Tài khoản Gemini</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Quản lý pool tài khoản —{" "}
            <span className="font-medium text-green-600">{freeCount}</span> / {accounts.length} sẵn sàng
          </p>
        </div>
        <button
          onClick={handleHealthCheckAll}
          disabled={checking !== null}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {checking === "all" ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Check All Sessions
        </button>
      </div>

      {/* ── Status filter ── */}
      <div className="mb-4 flex flex-wrap gap-2">
        {filterButtons.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === f.key
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* ── LOGIN MODAL ── */}
      {modalMode === "login" && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-slate-800">
              Đăng nhập lại trên {editing.vps_name || `VPS #${editing.vps_id}`}
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Account: <strong>{email}</strong>
            </p>

            {!editing.vps_id && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-800">Account chưa gán VPS</p>
                  <p className="mt-1 text-xs text-red-600">Hãy gán account vào VPS trước khi đăng nhập.</p>
                </div>
                <button onClick={closeModal} className="w-full rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">Đóng</button>
              </div>
            )}

            {editing.vps_id && loginStatus === "idle" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Nhấn &quot;Bắt đầu&quot; để mở trình duyệt trên VPS. Sau đó đăng nhập Google qua noVNC.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleLoginStart(false)}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    ▶ Bắt đầu đăng nhập
                  </button>
                  <button
                    onClick={() => handleLoginStart(true)}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
                    title="Xóa cookies cũ và đăng nhập lại từ đầu"
                  >
                    🔄 Reset
                  </button>
                </div>
                <div className="flex justify-end">
                  <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">Hủy</button>
                </div>
              </div>
            )}

            {loginStatus === "opening" && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                <span className="text-sm text-slate-600">Đang khởi động trình duyệt trên VPS...</span>
              </div>
            )}

            {loginStatus === "active" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="mb-1 text-sm font-medium text-green-800">✅ Trình duyệt đã sẵn sàng</p>
                  <p className="text-xs text-green-700">{loginMessage}</p>
                </div>
                <a
                  href={loginVncUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  🖥 Mở noVNC để đăng nhập
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>Lưu ý:</strong> Sau khi đăng nhập xong trên noVNC, quay lại đây nhấn &quot;Hoàn tất&quot;.
                  </p>
                </div>
                <button
                  onClick={handleLoginFinish}
                  className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  ✅ Hoàn tất đăng nhập
                </button>
                <div className="flex justify-end">
                  <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">Hủy</button>
                </div>
              </div>
            )}

            {loginStatus === "stopping" && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                <span className="text-sm text-slate-600">{loginMessage}</span>
              </div>
            )}

            {loginStatus === "success" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <p className="text-2xl mb-1">🎉</p>
                  <p className="text-sm font-semibold text-green-800">{loginMessage}</p>
                  <p className="mt-1 text-xs text-green-600">Auth cookies: {loginAuthCookies}/6</p>
                </div>
                <button onClick={closeModal} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">Đóng</button>
              </div>
            )}

            {loginStatus === "error" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-800">❌ Thất bại</p>
                  <p className="mt-1 text-xs text-red-600">{loginMessage}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setLoginStatus("idle")} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">Thử lại</button>
                  <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">Đóng</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {modalMode === "edit" && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">Sửa Account</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="account@gmail.com"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Cookie Directory</label>
                <input
                  value={cookieDir}
                  onChange={(e) => setCookieDir(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="cookies/account@gmail.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Trạng thái</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="free">Sẵn sàng</option>
                  <option value="busy">Đang dùng</option>
                  <option value="cooldown">Cooldown</option>
                  <option value="disabled">Hết session</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">Hủy</button>
              <button
                onClick={handleSave}
                disabled={saving || !email.trim() || !cookieDir.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ACCOUNTS LIST ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">Chưa có tài khoản Gemini nào</p>
          <p className="mt-1 text-xs text-slate-400">Vào trang VPS, bấm &quot;+ Thêm&quot; để tạo và đăng nhập account</p>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 py-12 text-center">
          <p className="text-sm text-slate-500">Không có account nào với trạng thái đã chọn</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAccounts.map((a) => {
            const rateLimited = isRateLimited(a);
            const effStatus = getEffectiveStatus(a);
            const cfg = statusConfig[effStatus] || statusConfig.free;
            const health = healthResults[a.id];
            return (
              <div
                key={a.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                {/* Header */}
                <div className="mb-3 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-700">{a.email}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {a.vps_name ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7" />
                          </svg>
                          {a.vps_name}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">Chưa gán VPS</span>
                      )}
                    </div>
                    {a.last_used_at && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        Dùng: {formatTime(a.last_used_at)}
                      </p>
                    )}
                  </div>
                  <span className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>

                {/* Rate limited info */}
                {rateLimited && (
                  <div className="mb-3 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
                    ⏰ {getRateLimitRemaining(a)} — hết hạn lúc {formatTime(a.rate_limited_until)}
                  </div>
                )}

                {/* Health result */}
                {health && (
                  <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${
                    health.status === "ok"
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}>
                    {health.status === "ok" ? "✓ Session hoạt động" : `✗ ${health.message}`}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => handleHealthCheck(a.id)}
                    disabled={checking !== null}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-purple-600 transition hover:bg-purple-50 disabled:opacity-50"
                  >
                    {checking === a.id ? "Đang check..." : "Check Session"}
                  </button>
                  {a.vps_id && (a.status === "disabled" || (health && health.status !== "ok")) && (
                    <button
                      onClick={() => handleRelogin(a)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-600 transition hover:bg-amber-50"
                    >
                      🔑 Đăng nhập lại
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(a)}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                  >
                    Sửa
                  </button>
                  {a.status !== "free" && a.status !== "active" && a.status !== "disabled" && (
                    <button
                      onClick={() => handleReset(a.id)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-green-600 transition hover:bg-green-50"
                    >
                      Reset
                    </button>
                  )}
                  {rateLimited && (
                    <button
                      onClick={() => handleReset(a.id)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-orange-600 transition hover:bg-orange-50"
                    >
                      Gỡ limit
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
