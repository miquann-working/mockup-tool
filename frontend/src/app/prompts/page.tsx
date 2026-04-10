"use client";

import { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";

function formatTime(dt: string | null | undefined) {
  if (!dt) return "";
  const s = dt.endsWith("Z") ? dt : dt + "Z";
  return new Date(s).toLocaleDateString("vi-VN");
}

interface Prompt {
  id?: number;
  name: string;
  content: string;
  mode: "mockup" | "line_drawing";
}

interface PromptGroup {
  id: number;
  name: string;
  role: "mockup" | "trade";
  user_id: number | null;
  owner_name: string | null;
  prompts: Prompt[];
  created_at: string;
}

interface UserOption {
  id: number;
  username: string;
  role: string;
}

const emptyMockupPrompts = (): Prompt[] => [
  { name: "Góc 1", content: "", mode: "mockup" },
  { name: "Góc 2", content: "", mode: "mockup" },
  { name: "Góc 3", content: "", mode: "mockup" },
  { name: "Góc 4", content: "", mode: "mockup" },
];

const emptyTradePrompts = (): Prompt[] => [
  { name: "Trade Prompt", content: "", mode: "mockup" },
];

function getEmptyPrompts(role: string): Prompt[] {
  return role === "trade" ? emptyTradePrompts() : emptyMockupPrompts();
}

export default function ManagePromptsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PromptGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [prompts, setPrompts] = useState<Prompt[]>(getEmptyPrompts(user?.role || "mockup"));
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterUserId, setFilterUserId] = useState<string>("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tab, setTab] = useState<"all" | "mine">("all");
  // Admin: filter by group role (mockup / trade)
  const [filterRole, setFilterRole] = useState<string>("");
  // Admin: role when creating a new group
  const [newGroupRole, setNewGroupRole] = useState<"mockup" | "trade">("mockup");

  useEffect(() => {
    if (isAdmin) {
      api.get("/users").then((r) => setUsers(r.data)).catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchGroups = useCallback(() => {
    const params: Record<string, string | number> = { page, limit: 20 };
    if (search.trim()) params.search = search.trim();
    if (isAdmin && filterUserId) params.user_id = Number(filterUserId);
    if (isAdmin && filterRole) params.role = filterRole;
    if (!isAdmin && tab === "mine" && user) params.user_id = user.id;
    api
      .get("/prompt-groups", { params })
      .then((r) => {
        const body = r.data;
        if (body.data) {
          setGroups(body.data);
          setTotalPages(body.pagination?.totalPages || 1);
          setTotal(body.pagination?.total || 0);
        } else {
          setGroups(Array.isArray(body) ? body : []);
          setTotalPages(1);
          setTotal(0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, filterUserId, filterRole, tab, isAdmin, user]);

  useEffect(() => {
    setLoading(true);
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    setPage(1);
  }, [search, filterUserId, filterRole, tab]);

  const canEdit = (g: PromptGroup) => isAdmin || (user && g.user_id === user.id);

  const openCreate = () => {
    setEditing(null);
    setGroupName("");
    const role = isAdmin ? newGroupRole : (user?.role === "trade" ? "trade" : "mockup");
    setPrompts(getEmptyPrompts(role));
    setShowForm(true);
  };

  const openEdit = (g: PromptGroup) => {
    if (!canEdit(g)) return;
    setEditing(g);
    setGroupName(g.name);
    setPrompts(g.prompts.length > 0 ? [...g.prompts] : getEmptyPrompts(g.role || "mockup"));
    if (isAdmin) setNewGroupRole(g.role || "mockup");
    setShowForm(true);
  };

  const updatePrompt = (index: number, field: "name" | "content" | "mode", value: string) => {
    setPrompts((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const addPrompt = () => {
    setPrompts((prev) => [
      ...prev,
      { name: `Prompt ${prev.length + 1}`, content: "", mode: "mockup" },
    ]);
  };

  const removePrompt = (index: number) => {
    if (prompts.length <= 1) return;
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const canSave =
    groupName.trim() &&
    prompts.length > 0 &&
    prompts.every((p) => p.name.trim() && p.content.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: groupName.trim(),
        prompts: prompts.map((p) => ({
          ...(p.id ? { id: p.id } : {}),
          name: p.name.trim(),
          content: p.content.trim(),
          mode: p.mode,
        })),
      };
      if (isAdmin) payload.role = newGroupRole;
      if (editing) {
        await api.put(`/prompt-groups/${editing.id}`, payload);
      } else {
        await api.post("/prompt-groups", payload);
      }
      setShowForm(false);
      fetchGroups();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Lưu thất bại";
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Xóa chủ đề này và tất cả prompts?")) return;
    try {
      await api.delete(`/prompt-groups/${id}`);
      if (expandedId === id) setExpandedId(null);
      fetchGroups();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Không có quyền xóa";
      alert(msg);
    }
  };

  return (
    <ProtectedRoute>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Quản lý Chủ đề Prompt</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {total} chủ đề.{" "}
              {isAdmin
                ? "Admin có quyền quản lý tất cả."
                : "Bạn có thể thêm/sửa/xóa chủ đề của mình, xem chủ đề của người khác."}
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Thêm Chủ đề
          </button>
        </div>

        {/* Search + Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {!isAdmin && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
              <button
                onClick={() => setTab("all")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  tab === "all" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setTab("mine")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  tab === "mine" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Của tôi
              </button>
            </div>
          )}
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo tên chủ đề..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {isAdmin && (
            <select
              value={filterUserId}
              onChange={(e) => {
                const uid = e.target.value;
                setFilterUserId(uid);
                if (uid) {
                  const u = users.find((u) => String(u.id) === uid);
                  if (u && u.role !== "admin") setFilterRole(u.role);
                }
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Tất cả user</option>
              {users.filter((u) => !filterRole || u.role === filterRole || u.role === "admin").map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          )}
          {isAdmin && (
            <select
              value={filterRole}
              onChange={(e) => {
                const role = e.target.value;
                setFilterRole(role);
                if (role && filterUserId) {
                  const u = users.find((u) => String(u.id) === filterUserId);
                  if (u && u.role !== role) setFilterUserId("");
                }
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Tất cả loại</option>
              <option value="mockup">Mockup</option>
              <option value="trade">Trade</option>
            </select>
          )}
        </div>

        {/* ───── Modal form (wide, horizontal prompt cards) ───── */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10">
            <div className="w-[95vw] max-w-[1600px] rounded-xl bg-white p-6 shadow-xl">
              <h3 className="mb-4 text-lg font-semibold text-slate-800">
                {editing ? "Sửa Chủ đề" : "Thêm Chủ đề mới"}
              </h3>
              {/* Admin: select role type for this group */}
              {isAdmin && (
                <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-600">Loại:</label>
                  <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => { setNewGroupRole("mockup"); if (!editing) setPrompts(getEmptyPrompts("mockup")); }}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        newGroupRole === "mockup" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >Mockup</button>
                    <button
                      type="button"
                      onClick={() => { setNewGroupRole("trade"); if (!editing) setPrompts(getEmptyPrompts("trade")); }}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        newGroupRole === "trade" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >Trade</button>
                  </div>
                </div>
              )}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  Tên chủ đề <span className="text-red-500">*</span>
                </label>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    groupName.trim()
                      ? "border-slate-300 focus:border-blue-500 focus:ring-blue-500/20"
                      : "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                  }`}
                  placeholder="VD: Phòng khách, Phòng ngủ, Ngoại thất..."
                  autoFocus
                />
              </div>

              <div className="mb-4">
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-600">
                    Các Prompt ({prompts.length}) <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1">
                    <button
                      onClick={addPrompt}
                      className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
                    >+ Thêm prompt</button>
                  </div>
                </div>
                {/* Prompt cards for editing — mockup 4/row, line 1/row */}
                <div className="max-h-[60vh] overflow-y-auto space-y-3">
                  {/* Mockup prompts grid */}
                  {prompts.some((p) => p.mode !== "line_drawing") && (
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {prompts.map((p, i) => {
                        if (p.mode === "line_drawing") return null;
                        const nameEmpty = !p.name.trim();
                        const contentEmpty = !p.content.trim();
                        return (
                          <div key={i} className="flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 min-w-0">
                            <div className="mb-2 flex items-center gap-2 min-w-0">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white bg-blue-600">{i + 1}</span>
                              <input value={p.name} onChange={(e) => updatePrompt(i, "name", e.target.value)} className={`min-w-0 flex-1 rounded border px-2 py-1 text-sm focus:outline-none ${nameEmpty ? "border-red-300" : "border-slate-300 focus:border-blue-500"}`} placeholder="Tên prompt" />
                              {prompts.length > 1 && (
                                <button onClick={() => removePrompt(i)} className="shrink-0 rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="Xóa"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                              )}
                            </div>
                            <textarea value={p.content} onChange={(e) => updatePrompt(i, "content", e.target.value)} rows={16} className={`flex-1 w-full rounded border px-2 py-1.5 text-xs leading-relaxed focus:outline-none resize-y ${contentEmpty ? "border-red-300" : "border-slate-300 focus:border-blue-500"}`} placeholder="Nội dung prompt gửi cho Gemini..." />
                            {contentEmpty && <p className="mt-1 text-[10px] text-red-500">Không được trống</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Line drawing prompts — full width */}
                  {prompts.map((p, i) => {
                    if (p.mode !== "line_drawing") return null;
                    const nameEmpty = !p.name.trim();
                    const contentEmpty = !p.content.trim();
                    return (
                      <div key={i} className="flex flex-col rounded-lg border border-amber-200 bg-amber-50/50 p-3 min-w-0">
                        <div className="mb-2 flex items-center gap-2 min-w-0">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white bg-amber-500">✏</span>
                          <input value={p.name} onChange={(e) => updatePrompt(i, "name", e.target.value)} className={`min-w-0 flex-1 rounded border px-2 py-1 text-sm focus:outline-none ${nameEmpty ? "border-red-300" : "border-slate-300 focus:border-blue-500"}`} placeholder="Tên prompt" />
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">LINE</span>
                          {prompts.length > 1 && (
                            <button onClick={() => removePrompt(i)} className="shrink-0 rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="Xóa"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                          )}
                        </div>
                        <textarea value={p.content} onChange={(e) => updatePrompt(i, "content", e.target.value)} rows={6} className={`flex-1 w-full rounded border px-2 py-1.5 text-xs leading-relaxed focus:outline-none resize-y ${contentEmpty ? "border-red-300" : "border-slate-300 focus:border-blue-500"}`} placeholder="Nội dung prompt gửi cho Gemini..." />
                        {contentEmpty && <p className="mt-1 text-[10px] text-red-500">Không được trống</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">Hủy</button>
                <button
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ───── Groups list ───── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
            <p className="text-sm text-slate-400">
              {search || filterUserId || tab === "mine" ? "Không tìm thấy chủ đề phù hợp" : "Chưa có chủ đề nào"}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {groups.map((g) => {
                const mine = canEdit(g);
                const expanded = expandedId === g.id;
                return (
                  <div
                    key={g.id}
                    className={`overflow-hidden rounded-xl border bg-white shadow-sm transition ${
                      mine ? "border-blue-200" : "border-slate-200"
                    } ${expanded ? "shadow-md" : "hover:shadow-md"}`}
                  >
                    {/* Clickable header row */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(expanded ? null : g.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(expanded ? null : g.id); }}
                      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <svg
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                        fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-700 truncate">{g.name}</h3>
                          {isAdmin && (
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              g.role === "trade" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                            }`}>
                              {g.role === "trade" ? "Trade" : "Mockup"}
                            </span>
                          )}
                          {g.owner_name && (
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              user && g.user_id === user.id ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                            }`}>
                              {user && g.user_id === user.id ? "Của bạn" : g.owner_name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {g.prompts.length} prompt{g.prompts.length !== 1 ? "s" : ""} • {formatTime(g.created_at)}
                        </p>
                      </div>
                      {/* Prompt name pills (visible when collapsed) */}
                      {!expanded && (
                        <div className="hidden sm:flex flex-wrap gap-1 shrink-0 max-w-[50%] justify-end">
                          {g.prompts.map((p, i) => (
                            <span key={p.id || i} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              p.mode === "line_drawing" ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"
                            }`}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {mine && (
                        <div className="flex gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => openEdit(g)} className="rounded px-2 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50">Sửa</button>
                          <button onClick={() => handleDelete(g.id)} className="rounded px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50">Xóa</button>
                        </div>
                      )}
                    </div>

                    {/* Expanded detail: mockup 4/row, line 1/row */}
                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-4 space-y-3">
                        {g.role === "trade" ? (
                          /* Trade: 1 prompt, full width */
                          g.prompts.map((p, i) => (
                            <div key={p.id || i} className="flex flex-col rounded-lg border border-amber-200 bg-amber-50 p-4">
                              <div className="mb-2 flex items-center gap-2">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold bg-amber-500 text-white">✏</span>
                                <span className="text-sm font-semibold text-slate-700">{p.name}</span>
                                <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-600">LINE</span>
                              </div>
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{p.content}</p>
                            </div>
                          ))
                        ) : (
                          /* Mockup: 4 prompts per row */
                          <>
                            {g.prompts.some((p) => p.mode !== "line_drawing") && (
                              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                {g.prompts.map((p, i) => {
                                  if (p.mode === "line_drawing") return null;
                                  return (
                                    <div key={p.id || i} className="flex flex-col rounded-lg border border-slate-200 bg-white p-3">
                                      <div className="mb-2 flex items-center gap-2">
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold bg-blue-600 text-white">{i + 1}</span>
                                        <span className="text-sm font-semibold text-slate-700 truncate">{p.name}</span>
                                      </div>
                                      <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{p.content}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {g.prompts.map((p, i) => {
                              if (p.mode !== "line_drawing") return null;
                              return (
                                <div key={p.id || i} className="flex flex-col rounded-lg border border-amber-200 bg-amber-50 p-3">
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold bg-amber-500 text-white">✏</span>
                                    <span className="text-sm font-semibold text-slate-700 truncate">{p.name}</span>
                                    <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-600">LINE</span>
                                  </div>
                                  <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{p.content}</p>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination - always show */}
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                ← Trước
              </button>
              <span className="px-3 text-sm text-slate-500">
                Trang {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Sau →
              </button>
            </div>
          </>
        )}
      </main>
    </ProtectedRoute>
  );
}
