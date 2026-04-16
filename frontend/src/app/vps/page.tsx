"use client";

import { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";

interface VpsAccount {
  id: number;
  email: string;
  status: string;
  last_used_at: string | null;
}

interface VpsNode {
  id: number;
  name: string;
  host: string;
  port: number;
  status: "online" | "offline";
  max_concurrent: number;
  last_heartbeat: string | null;
  created_at: string;
}

function timeAgo(dt: string | null | undefined) {
  if (!dt) return "Chưa bao giờ";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s trước`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}p trước`;
  return `${Math.floor(diff / 3600_000)}h trước`;
}

type ModalMode = null | "login" | "add-account";
type LoginStep = "idle" | "starting" | "active" | "stopping" | "success" | "error";

function MyVpsContent() {
  const [node, setNode] = useState<VpsNode | null>(null);
  const [accounts, setAccounts] = useState<VpsAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalMode, setModalMode] = useState<ModalMode>(null);

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginStep, setLoginStep] = useState<LoginStep>("idle");
  const [loginVncUrl, setLoginVncUrl] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginAuthCookies, setLoginAuthCookies] = useState(0);

  // Add account state
  const [newAccountEmail, setNewAccountEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(() => {
    api
      .get("/vps/my")
      .then((r) => {
        setNode(r.data.node);
        setAccounts(r.data.accounts);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const closeModal = () => {
    setModalMode(null);
    setLoginEmail("");
    setLoginStep("idle");
    setLoginVncUrl("");
    setLoginMessage("");
    setLoginAuthCookies(0);
    setNewAccountEmail("");
  };

  const openLogin = (email: string) => {
    closeModal();
    setLoginEmail(email);
    setModalMode("login");
  };

  const openAddAccount = () => {
    closeModal();
    setModalMode("add-account");
  };

  const handleRemoveAccount = async (accId: number, email: string) => {
    if (!confirm(`Gỡ ${email} khỏi VPS?`)) return;
    try {
      await api.post("/vps/my/remove-account", { account_id: accId });
      fetchData();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Gỡ account thất bại");
    }
  };

  const handleAddAccount = async () => {
    if (!newAccountEmail.trim()) return;
    setSaving(true);
    try {
      await api.post("/vps/my/add-account", { email: newAccountEmail.trim() });
      const email = newAccountEmail.trim();
      closeModal();
      fetchData();
      // Open login modal for the new account
      setTimeout(() => openLogin(email), 300);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Thêm account thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleLoginStart = async (reset = false) => {
    setLoginStep("starting");
    setLoginMessage("");
    try {
      const r = await api.post("/vps/my/login/start", {
        email: loginEmail,
        reset,
      });
      setLoginVncUrl(r.data.vnc_url);
      setLoginStep("active");
      setLoginMessage(
        "Trình duyệt đã mở trên VPS. Hãy đăng nhập Google trong cửa sổ noVNC."
      );
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setLoginStep("error");
      setLoginMessage(
        axiosErr.response?.data?.error || "Không thể khởi động phiên đăng nhập"
      );
    }
  };

  const handleLoginFinish = async () => {
    setLoginStep("stopping");
    setLoginMessage("Đang dừng trình duyệt và kiểm tra cookies...");
    try {
      const r = await api.post("/vps/my/login/stop", {
        email: loginEmail,
      });
      if (r.data.ok) {
        setLoginStep("success");
        setLoginAuthCookies(r.data.auth_cookies || 0);
        setLoginMessage(r.data.message || "Đăng nhập thành công!");
        fetchData();
      } else {
        setLoginStep("error");
        setLoginMessage(
          r.data.message || "Đăng nhập thất bại — cookies không đủ"
        );
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setLoginStep("error");
      setLoginMessage(
        axiosErr.response?.data?.error || "Lỗi khi hoàn tất đăng nhập"
      );
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!node) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
        <svg
          className="mx-auto mb-3 h-12 w-12 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
          />
        </svg>
        <p className="text-sm font-medium text-slate-500">
          Bạn chưa được gán VPS nào
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Liên hệ admin để được gán VPS
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Add account modal */}
      {modalMode === "add-account" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-slate-800">
              Thêm Account Gemini
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Nhập email Google, hệ thống sẽ tạo account và mở đăng nhập luôn
            </p>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Email Google
              </label>
              <input
                value={newAccountEmail}
                onChange={(e) => setNewAccountEmail(e.target.value)}
                placeholder="yourname@gmail.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAddAccount()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={handleAddAccount}
                disabled={saving || !newAccountEmail.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Đang tạo..." : "Tạo & Đăng nhập"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login modal */}
      {modalMode === "login" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-slate-800">
              Đăng nhập Gemini
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Account: <strong>{loginEmail}</strong>
            </p>

            {loginStep === "idle" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Nhấn &quot;Bắt đầu&quot; để mở trình duyệt trên VPS. Sau đó
                  đăng nhập Google qua noVNC.
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
              </div>
            )}

            {loginStep === "starting" && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                <span className="text-sm text-slate-600">
                  Đang khởi động trình duyệt trên VPS...
                </span>
              </div>
            )}

            {loginStep === "active" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="mb-2 text-sm font-medium text-green-800">
                    ✅ Trình duyệt đã sẵn sàng
                  </p>
                  <p className="text-xs text-green-700">{loginMessage}</p>
                </div>

                <a
                  href={loginVncUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  🖥 Mở noVNC để đăng nhập
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>Lưu ý:</strong> Sau khi đăng nhập xong trên noVNC,
                    quay lại đây nhấn &quot;Hoàn tất&quot;. Đừng đóng modal này
                    khi chưa hoàn tất.
                  </p>
                </div>

                <button
                  onClick={handleLoginFinish}
                  className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  ✅ Hoàn tất đăng nhập
                </button>
              </div>
            )}

            {loginStep === "stopping" && (
              <div className="flex items-center gap-3 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                <span className="text-sm text-slate-600">{loginMessage}</span>
              </div>
            )}

            {loginStep === "success" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <p className="mb-1 text-2xl">🎉</p>
                  <p className="text-sm font-semibold text-green-800">
                    {loginMessage}
                  </p>
                  <p className="mt-1 text-xs text-green-600">
                    Auth cookies: {loginAuthCookies}/6
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Đóng
                </button>
              </div>
            )}

            {loginStep === "error" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-800">
                    ❌ Thất bại
                  </p>
                  <p className="mt-1 text-xs text-red-600">{loginMessage}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLoginStep("idle")}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    Thử lại
                  </button>
                  <button
                    onClick={closeModal}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}

            {(loginStep === "idle" || loginStep === "active") && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={closeModal}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Hủy
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VPS card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                node.status === "online"
                  ? "bg-green-500 shadow-sm shadow-green-200"
                  : "bg-slate-300"
              }`}
            />
            <div>
              <h3 className="font-semibold text-slate-800">{node.name}</h3>
              <p className="text-xs text-slate-400">
                <span
                  className={`font-medium ${
                    node.status === "online"
                      ? "text-green-600"
                      : "text-slate-400"
                  }`}
                >
                  {node.status === "online" ? "Online" : "Offline"}
                </span>
                <span className="ml-2">·</span>
                <span className="ml-2">
                  Heartbeat: {timeAgo(node.last_heartbeat)}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Accounts */}
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tài khoản Gemini ({accounts.length})
            </h4>
            <button
              onClick={openAddAccount}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Thêm Account
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
              <p className="text-sm text-slate-400">
                Chưa có account nào
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Thêm tài khoản Google để bắt đầu sử dụng
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium text-slate-700">
                      {acc.email}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemoveAccount(acc.id, acc.email)}
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100"
                      title="Gỡ khỏi VPS"
                    >
                      Gỡ
                    </button>
                    <button
                      onClick={() => openLogin(acc.email)}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                    >
                      🔑 Đăng nhập
                    </button>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        acc.status === "free" || acc.status === "active"
                          ? "bg-green-100 text-green-700"
                          : acc.status === "busy"
                            ? "bg-blue-100 text-blue-700"
                            : acc.status === "disabled"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {acc.status === "disabled"
                        ? "Hết session"
                        : acc.status === "active"
                          ? "Sẵn sàng"
                          : acc.status === "free"
                            ? "Sẵn sàng"
                            : acc.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 text-xs text-slate-400">
          <span>
            Max song song:{" "}
            <strong className="text-slate-600">{node.max_concurrent}</strong>
          </span>
        </div>
      </div>
    </>
  );
}

export default function MyVpsPage() {
  return (
    <ProtectedRoute>
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-800">VPS của tôi</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Xem VPS được gán và quản lý tài khoản Gemini
          </p>
        </div>
        <MyVpsContent />
      </main>
    </ProtectedRoute>
  );
}
