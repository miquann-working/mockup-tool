"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

interface GeminiAccount {
  id: number;
  email: string;
  cookie_dir: string;
  status: "free" | "busy" | "cooldown" | "disabled";
  last_used_at: string | null;
  created_at: string;
  rate_limited_until: string | null;
}

function formatTime(dt: string | null | undefined) {
  if (!dt) return "";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  return new Date(s).toLocaleString("vi-VN");
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  free: { label: "Sẵn sàng", color: "text-green-700", bg: "bg-green-100", icon: "✓" },
  busy: { label: "Đang dùng", color: "text-blue-700", bg: "bg-blue-100", icon: "⟳" },
  cooldown: { label: "Cooldown", color: "text-amber-700", bg: "bg-amber-100", icon: "⏳" },
  disabled: { label: "Tắt", color: "text-slate-600", bg: "bg-slate-100", icon: "✗" },
  rate_limited: { label: "Hết lượt tạo ảnh", color: "text-red-700", bg: "bg-red-100", icon: "⛔" },
};

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

type ModalMode = null | "add" | "edit" | "login";

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
  const [cookieFile, setCookieFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<"idle" | "opening" | "waiting" | "success" | "error">("idle");

  const fetchAccounts = useCallback(() => {
    api.get("/accounts").then((r) => setAccounts(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Poll for account changes when login browser is open
  useEffect(() => {
    if (loginStatus !== "waiting") return;
    const interval = setInterval(() => {
      api.get("/accounts").then((r) => {
        const updated = r.data as GeminiAccount[];
        setAccounts(updated);
        const found = updated.find((a: GeminiAccount) => a.email === email);
        if (found && found.status === "free") {
          setLoginStatus("success");
        }
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [loginStatus, email]);

  const closeModal = () => {
    setModalMode(null);
    setEditing(null);
    setEmail("");
    setCookieDir("");
    setStatus("free");
    setCookieFile(null);
    setLoginStatus("idle");
  };

  const openAdd = () => {
    closeModal();
    setModalMode("add");
  };

  const openLogin = () => {
    closeModal();
    setModalMode("login");
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
      } else {
        await api.post("/accounts", { email, cookie_dir: cookieDir });
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

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (!editing) {
      setCookieDir(val ? `cookies/${val}` : "");
    }
  };

  const handleUploadCookie = async () => {
    if (!email.trim() || !cookieFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("email", email.trim());
      fd.append("cookies", cookieFile);
      const token = localStorage.getItem("token");
      const backendUrl = window.location.protocol + "//" + window.location.hostname + ":4000";
      const resp = await fetch(backendUrl + "/api/accounts/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + (token || "") },
        body: fd,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Upload thất bại");
      }
      closeModal();
      fetchAccounts();
    } catch (err: unknown) {
      const e = err as Error;
      alert(e.message || "Upload thất bại");
    } finally {
      setUploading(false);
    }
  };

  const handleSetupLogin = async () => {
    if (!email.trim()) return;
    setLoginStatus("opening");
    try {
      await api.post("/accounts/setup-login", { email: email.trim() });
      setLoginStatus("waiting");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Không thể mở browser");
      setLoginStatus("error");
    }
  };

  const handleRelogin = async (account: GeminiAccount) => {
    closeModal();
    setEmail(account.email);
    setModalMode("login");
    // small delay to let state update, then trigger login
    setTimeout(async () => {
      setLoginStatus("opening");
      try {
        await api.post("/accounts/setup-login", { email: account.email });
        setLoginStatus("waiting");
      } catch {
        setLoginStatus("error");
      }
    }, 100);
  };

  const freeCount = accounts.filter((a) => a.status === "free" && !isRateLimited(a)).length;

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
        <div className="flex gap-2">
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
            Check All
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Upload Cookie
          </button>
          <button
            onClick={openLogin}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Đăng nhập Gemini
          </button>
        </div>
      </div>

      {/* ── LOGIN MODAL ── */}
      {modalMode === "login" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Đăng nhập tài khoản Gemini</h3>
                <p className="text-sm text-slate-500">Browser sẽ mở để bạn đăng nhập Google</p>
              </div>
            </div>

            {loginStatus === "idle" && (
              <>
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Email Google</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="yourname@gmail.com"
                    autoFocus
                  />
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <h4 className="mb-2 text-sm font-medium text-slate-700">Hướng dẫn:</h4>
                  <ol className="space-y-1.5 text-sm text-slate-600">
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">1.</span> Nhập email rồi bấm &quot;Mở Browser&quot;</li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">2.</span> Browser Chromium sẽ mở ra trang đăng nhập Google</li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">3.</span> Đăng nhập bình thường (nhập mật khẩu, xác thực 2 bước...)</li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">4.</span> Khi Gemini load xong → cookie tự động lưu, browser tự đóng</li>
                  </ol>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={closeModal}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleSetupLogin}
                    disabled={!email.trim()}
                    className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    Mở Browser
                  </button>
                </div>
              </>
            )}

            {loginStatus === "opening" && (
              <div className="flex flex-col items-center py-8">
                <div className="h-10 w-10 animate-spin rounded-full border-3 border-blue-600 border-t-transparent" />
                <p className="mt-4 text-sm font-medium text-slate-600">Đang mở browser...</p>
              </div>
            )}

            {loginStatus === "waiting" && (
              <div className="flex flex-col items-center py-6">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                  <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="mb-1 text-base font-semibold text-slate-700">Đang chờ bạn đăng nhập...</h4>
                <p className="mb-4 text-center text-sm text-slate-500">
                  Hãy đăng nhập vào Google trên cửa sổ browser vừa mở.<br />
                  Trang này sẽ tự cập nhật khi hoàn tất.
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2">
                  <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
                  <span className="text-sm font-medium text-blue-700">Đang theo dõi: {email}</span>
                </div>
                <button
                  onClick={closeModal}
                  className="mt-6 rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
                >
                  Đóng (browser vẫn hoạt động)
                </button>
              </div>
            )}

            {loginStatus === "success" && (
              <div className="flex flex-col items-center py-6">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="mb-1 text-base font-semibold text-green-700">Thêm tài khoản thành công!</h4>
                <p className="text-sm text-slate-500">{email} đã sẵn sàng sử dụng</p>
                <button
                  onClick={() => { closeModal(); fetchAccounts(); }}
                  className="mt-6 rounded-lg bg-green-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  Đóng
                </button>
              </div>
            )}

            {loginStatus === "error" && (
              <div className="flex flex-col items-center py-6">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <h4 className="mb-1 text-base font-semibold text-red-700">Lỗi</h4>
                <p className="text-sm text-slate-500">Không thể mở browser. Thử lại sau.</p>
                <button
                  onClick={() => setLoginStatus("idle")}
                  className="mt-6 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Thử lại
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADD/EDIT MODAL ── */}
      {(modalMode === "add" || modalMode === "edit") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">
              {editing ? "Sửa Account" : "Thêm Account (Upload Cookie)"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Email</label>
                <input
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="account@gmail.com"
                  autoFocus
                />
              </div>
              {!editing && (
                <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/50 p-4">
                  <label className="mb-2 block text-sm font-medium text-blue-700">
                    Upload file cookie (.zip)
                  </label>
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => setCookieFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-200"
                  />
                  <p className="mt-2 text-xs text-blue-600">
                    Lấy file .zip từ thư mục <code className="rounded bg-blue-100 px-1 font-mono">cookies/</code> sau khi chạy setup
                  </p>
                </div>
              )}
              {editing && (
                <>
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
                      <option value="disabled">Tắt</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Hủy
              </button>
              {!editing && cookieFile ? (
                <button
                  onClick={handleUploadCookie}
                  disabled={uploading || !email.trim()}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                >
                  {uploading ? "Đang upload..." : "Upload & Thêm"}
                </button>
              ) : editing ? (
                <button
                  onClick={handleSave}
                  disabled={saving || !email.trim() || !cookieDir.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Đang lưu..." : "Lưu"}
                </button>
              ) : null}
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
          <p className="mt-1 text-xs text-slate-400">Bấm &quot;Đăng nhập Gemini&quot; để thêm tài khoản đầu tiên</p>
          <button
            onClick={openLogin}
            className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Đăng nhập Gemini
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const rateLimited = isRateLimited(a);
            const cfg = rateLimited ? statusConfig.rate_limited : (statusConfig[a.status] || statusConfig.free);
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
                    {a.last_used_at && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        Dùng: {formatTime(a.last_used_at)}
                      </p>
                    )}
                  </div>
                  <span className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  {rateLimited && (
                    <div className="mt-1.5 w-full rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
                      ⏰ {getRateLimitRemaining(a)} — hết hạn lúc {formatTime(a.rate_limited_until)}
                    </div>
                  )}
                </div>

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
                    onClick={() => openEdit(a)}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => handleHealthCheck(a.id)}
                    disabled={checking !== null}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-purple-600 transition hover:bg-purple-50 disabled:opacity-50"
                  >
                    {checking === a.id ? "Đang check..." : "Check"}
                  </button>
                  {healthResults[a.id] && healthResults[a.id].status !== "ok" && (
                    <button
                      onClick={() => handleRelogin(a)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-600 transition hover:bg-amber-50"
                    >
                      Đăng nhập lại
                    </button>
                  )}
                  {a.status !== "free" && a.status !== "disabled" && (
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
