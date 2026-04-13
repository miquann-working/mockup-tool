"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

interface VpsAccount {
  id: number;
  email: string;
  status: string;
  last_used_at: string | null;
}

interface VpsUser {
  id: number;
  username: string;
  role: string;
}

interface VpsNode {
  id: number;
  name: string;
  host: string;
  port: number;
  secret_key: string;
  status: "online" | "offline";
  max_concurrent: number;
  last_heartbeat: string | null;
  created_at: string;
  accounts: VpsAccount[];
  users: VpsUser[];
}

interface AllAccount {
  id: number;
  email: string;
  status: string;
  vps_id: number | null;
}

interface AllUser {
  id: number;
  username: string;
  role: string;
  vps_id: number | null;
}

function formatTime(dt: string | null | undefined) {
  if (!dt) return "—";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  return new Date(s).toLocaleString("vi-VN");
}

function timeAgo(dt: string | null | undefined) {
  if (!dt) return "Chưa bao giờ";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s trước`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}p trước`;
  return `${Math.floor(diff / 3600_000)}h trước`;
}

type ModalMode = null | "add" | "edit" | "assign-accounts" | "assign-users" | "view-key";

export default function AdminVpsPage() {
  const [nodes, setNodes] = useState<VpsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editing, setEditing] = useState<VpsNode | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5001");
  const [maxConcurrent, setMaxConcurrent] = useState("3");
  const [saving, setSaving] = useState(false);

  // Assignment
  const [allAccounts, setAllAccounts] = useState<AllAccount[]>([]);
  const [allUsers, setAllUsers] = useState<AllUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // View key
  const [viewKey, setViewKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);

  const fetchNodes = useCallback(() => {
    api.get("/vps").then((r) => setNodes(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNodes();
    // Auto-refresh every 30s for heartbeat status
    const interval = setInterval(fetchNodes, 30_000);
    return () => clearInterval(interval);
  }, [fetchNodes]);

  const closeModal = () => {
    setModalMode(null);
    setEditing(null);
    setName("");
    setHost("");
    setPort("5001");
    setMaxConcurrent("3");
    setSelectedIds([]);
    setViewKey("");
    setKeyCopied(false);
  };

  const openAdd = () => {
    closeModal();
    setModalMode("add");
  };

  const openEdit = (node: VpsNode) => {
    closeModal();
    setEditing(node);
    setName(node.name);
    setHost(node.host);
    setPort(String(node.port));
    setMaxConcurrent(String(node.max_concurrent));
    setModalMode("edit");
  };

  const openAssignAccounts = async (node: VpsNode) => {
    closeModal();
    setEditing(node);
    try {
      const r = await api.get("/accounts");
      setAllAccounts(r.data);
      // Pre-select accounts already assigned to this VPS
      setSelectedIds(node.accounts.map((a) => a.id));
    } catch {
      alert("Không tải được danh sách accounts");
      return;
    }
    setModalMode("assign-accounts");
  };

  const openAssignUsers = async (node: VpsNode) => {
    closeModal();
    setEditing(node);
    try {
      const r = await api.get("/users");
      setAllUsers(r.data);
      setSelectedIds(node.users.map((u) => u.id));
    } catch {
      alert("Không tải được danh sách users");
      return;
    }
    setModalMode("assign-users");
  };

  const openViewKey = (node: VpsNode) => {
    closeModal();
    setEditing(node);
    setViewKey(node.secret_key);
    setModalMode("view-key");
  };

  // CRUD handlers
  const handleCreate = async () => {
    if (!name.trim() || !host.trim()) return;
    setSaving(true);
    try {
      await api.post("/vps", {
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port) || 5001,
        max_concurrent: parseInt(maxConcurrent) || 3,
      });
      closeModal();
      fetchNodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Tạo VPS thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing || !name.trim() || !host.trim()) return;
    setSaving(true);
    try {
      await api.put(`/vps/${editing.id}`, {
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port) || 5001,
        max_concurrent: parseInt(maxConcurrent) || 3,
      });
      closeModal();
      fetchNodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Cập nhật VPS thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Xóa VPS này? Accounts và Users sẽ bị gỡ liên kết.")) return;
    try {
      await api.delete(`/vps/${id}`);
      fetchNodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Xóa thất bại");
    }
  };

  const handleRegenerateKey = async (id: number) => {
    if (!confirm("Tạo API key mới? Key cũ sẽ ngưng hoạt động. Cần cập nhật .env trên VPS.")) return;
    try {
      const r = await api.post(`/vps/${id}/regenerate-key`);
      setViewKey(r.data.secret_key);
      fetchNodes();
      alert("Đã tạo API key mới!");
    } catch {
      alert("Tạo key mới thất bại");
    }
  };

  // Assignment handlers
  const handleSaveAssignAccounts = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const currentIds = editing.accounts.map((a) => a.id);
      const toAssign = selectedIds.filter((id) => !currentIds.includes(id));
      const toUnassign = currentIds.filter((id) => !selectedIds.includes(id));

      if (toAssign.length > 0) {
        await api.post(`/vps/${editing.id}/assign-accounts`, { account_ids: toAssign });
      }
      if (toUnassign.length > 0) {
        await api.post(`/vps/${editing.id}/unassign-accounts`, { account_ids: toUnassign });
      }
      closeModal();
      fetchNodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Gán account thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAssignUsers = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const currentIds = editing.users.map((u) => u.id);
      const toAssign = selectedIds.filter((id) => !currentIds.includes(id));
      const toUnassign = currentIds.filter((id) => !selectedIds.includes(id));

      if (toAssign.length > 0) {
        await api.post(`/vps/${editing.id}/assign-users`, { user_ids: toAssign });
      }
      if (toUnassign.length > 0) {
        await api.post(`/vps/${editing.id}/unassign-users`, { user_ids: toUnassign });
      }
      closeModal();
      fetchNodes();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error || "Gán user thất bại");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Quản lý VPS</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Quản lý các node VPS, gán accounts & users
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Thêm VPS
        </button>
      </div>

      {/* Add / Edit modal */}
      {(modalMode === "add" || modalMode === "edit") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">
              {modalMode === "add" ? "Thêm VPS mới" : `Sửa VPS: ${editing?.name}`}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Tên VPS</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: VPS-HCM-01"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-600">Host / IP / URL</label>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.100 hoặc https://agent1.domain.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Dùng IP cho mạng nội bộ, URL đầy đủ cho Cloudflare Tunnel
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    disabled={host.startsWith("http")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Max song song</label>
                <input
                  type="number"
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(e.target.value)}
                  min="1"
                  max="10"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="mt-1 text-xs text-slate-400">Số job chạy đồng thời tối đa trên VPS này</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={modalMode === "add" ? handleCreate : handleUpdate}
                disabled={saving || !name.trim() || !host.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : modalMode === "add" ? "Tạo" : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign accounts modal */}
      {modalMode === "assign-accounts" && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-slate-800">
              Gán Accounts → {editing.name}
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Chọn accounts sẽ chạy trên VPS này
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {allAccounts.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">Không có account nào</p>
              ) : (
                allAccounts.map((acc) => {
                  const assignedElsewhere = acc.vps_id && acc.vps_id !== editing.id;
                  const otherVps = assignedElsewhere ? nodes.find((n) => n.id === acc.vps_id) : null;
                  return (
                    <label
                      key={acc.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition ${
                        selectedIds.includes(acc.id) ? "bg-blue-50" : "hover:bg-slate-50"
                      } ${assignedElsewhere ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(acc.id)}
                        onChange={() => toggleSelect(acc.id)}
                        disabled={!!assignedElsewhere}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium text-slate-700">
                          {acc.email}
                        </div>
                        {assignedElsewhere && (
                          <div className="text-xs text-amber-600">
                            Đã gán cho {otherVps?.name || `VPS #${acc.vps_id}`}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveAssignAccounts}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign users modal */}
      {modalMode === "assign-users" && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-slate-800">
              Gán Users → {editing.name}
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Chọn users sẽ dùng VPS này để chạy job
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {allUsers.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">Không có user nào</p>
              ) : (
                allUsers.map((u) => {
                  const assignedElsewhere = u.vps_id && u.vps_id !== editing.id;
                  const otherVps = assignedElsewhere ? nodes.find((n) => n.id === u.vps_id) : null;
                  return (
                    <label
                      key={u.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition ${
                        selectedIds.includes(u.id) ? "bg-blue-50" : "hover:bg-slate-50"
                      } ${assignedElsewhere ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        disabled={!!assignedElsewhere}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">{u.username}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                            u.role === "admin" ? "bg-amber-100 text-amber-700" :
                            u.role === "trade" ? "bg-emerald-100 text-emerald-700" :
                            "bg-blue-100 text-blue-700"
                          }`}>{u.role}</span>
                        </div>
                        {assignedElsewhere && (
                          <div className="text-xs text-amber-600">
                            Đã gán cho {otherVps?.name || `VPS #${u.vps_id}`}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveAssignUsers}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View API key modal */}
      {modalMode === "view-key" && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-800">
              API Key: {editing.name}
            </h3>
            <div className="rounded-lg bg-slate-50 p-3">
              <code className="block break-all text-xs text-slate-700">{viewKey}</code>
            </div>

            {/* Setup instructions */}
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="mb-2 text-xs font-semibold text-blue-800">
                Lệnh cài đặt nhanh trên VPS:
              </p>
              {(() => {
                const serverUrl = editing.host.startsWith("http")
                  ? editing.host.replace(/\/+$/, "").replace(/\/agent\/?$/, "")
                  : `${window.location.protocol}//${window.location.hostname}:4000`;
                const cmd = `setup.bat ${serverUrl} ${viewKey} ${editing.port}`;
                return (
                  <div className="flex items-center gap-2">
                    <code className="block flex-1 break-all rounded bg-white px-2 py-1.5 text-xs text-slate-800 border border-blue-100">
                      {cmd}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(cmd)}
                      className="shrink-0 rounded bg-blue-100 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-200 transition"
                    >
                      Copy
                    </button>
                  </div>
                );
              })()}
              <p className="mt-2 text-[11px] text-blue-600 leading-relaxed">
                Copy thư mục <strong>agent/</strong> lên VPS, mở terminal trong thư mục đó rồi chạy lệnh trên.
                Script sẽ tự cài đặt dependencies và kết nối về server.
              </p>
            </div>

            <div className="mt-4 flex justify-between">
              <button
                onClick={() => handleRegenerateKey(editing.id)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Tạo key mới
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => copyKey(viewKey)}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                >
                  {keyCopied ? "✓ Đã copy key" : "Copy key"}
                </button>
                <button
                  onClick={closeModal}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
          </svg>
          <p className="text-sm font-medium text-slate-500">Chưa có VPS nào</p>
          <p className="mt-1 text-xs text-slate-400">Thêm VPS node đầu tiên để bắt đầu</p>
        </div>
      ) : (
        <div className="space-y-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              {/* VPS header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${
                    node.status === "online" ? "bg-green-500 shadow-sm shadow-green-200" : "bg-slate-300"
                  }`} />
                  <div>
                    <h3 className="font-semibold text-slate-800">{node.name}</h3>
                    <p className="text-xs text-slate-400">
                      {node.host.startsWith("http") ? node.host : `${node.host}:${node.port}`}
                      <span className="ml-2">·</span>
                      <span className={`ml-2 font-medium ${
                        node.status === "online" ? "text-green-600" : "text-slate-400"
                      }`}>
                        {node.status === "online" ? "Online" : "Offline"}
                      </span>
                      <span className="ml-2">·</span>
                      <span className="ml-2">Heartbeat: {timeAgo(node.last_heartbeat)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openViewKey(node)}
                    className="rounded px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
                    title="Xem API key"
                  >
                    🔑 Key
                  </button>
                  <button
                    onClick={() => openAssignAccounts(node)}
                    className="rounded px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                  >
                    Gán Accounts
                  </button>
                  <button
                    onClick={() => openAssignUsers(node)}
                    className="rounded px-2.5 py-1.5 text-xs font-medium text-purple-600 transition hover:bg-purple-50"
                  >
                    Gán Users
                  </button>
                  <button
                    onClick={() => openEdit(node)}
                    className="rounded px-2.5 py-1.5 text-xs font-medium text-amber-600 transition hover:bg-amber-50"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => handleDelete(node.id)}
                    className="rounded px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Xóa
                  </button>
                </div>
              </div>

              {/* VPS details */}
              <div className="grid grid-cols-2 gap-4 px-5 py-4">
                {/* Accounts */}
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Accounts ({node.accounts.length})
                  </h4>
                  {node.accounts.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Chưa gán account nào</p>
                  ) : (
                    <div className="space-y-1">
                      {node.accounts.map((acc) => (
                        <div key={acc.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                          <span className="truncate text-sm text-slate-700">{acc.email}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            acc.status === "free" ? "bg-green-100 text-green-700" :
                            acc.status === "busy" ? "bg-blue-100 text-blue-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {acc.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Users */}
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Users ({node.users.length})
                  </h4>
                  {node.users.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Chưa gán user nào</p>
                  ) : (
                    <div className="space-y-1">
                      {node.users.map((u) => (
                        <div key={u.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                          <span className="text-sm text-slate-700">{u.username}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.role === "admin" ? "bg-amber-100 text-amber-700" :
                            u.role === "trade" ? "bg-emerald-100 text-emerald-700" :
                            "bg-blue-100 text-blue-700"
                          }`}>
                            {u.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer stats */}
              <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 text-xs text-slate-400">
                <span>Max song song: <strong className="text-slate-600">{node.max_concurrent}</strong></span>
                <span>·</span>
                <span>Tạo: {formatTime(node.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
