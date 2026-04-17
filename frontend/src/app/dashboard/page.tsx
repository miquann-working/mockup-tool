"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageUpload from "@/components/ImageUpload";
import TopicSelector from "@/components/PromptSelector";
import JobCard from "@/components/JobCard";
import ImageLightbox from "@/components/ImageLightbox";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ── Download helpers (File System Access API with fallback) ──

async function downloadSingleImage(url: string, suggestedName: string) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    if ("showSaveFilePicker" in window) {
      const ext = suggestedName.split(".").pop() || "png";
      const mimeMap: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        webp: "image/webp", jfif: "image/jpeg",
      };
      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName,
        types: [{ description: "Image", accept: { [mimeMap[ext] || "image/png"]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== "AbortError") console.error("Download failed:", err);
  }
}

async function downloadBatchToFolder(images: { url: string; name: string }[]) {
  try {
    if ("showDirectoryPicker" in window) {
      const dirHandle = await (window as unknown as { showDirectoryPicker: (opts: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
      for (const img of images) {
        const response = await fetch(img.url);
        const blob = await response.blob();
        const fileHandle = await dirHandle.getFileHandle(img.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }
      alert(`Đã lưu ${images.length} ảnh thành công!`);
    } else {
      // Fallback: download each file individually
      for (const img of images) {
        const response = await fetch(img.url);
        const blob = await response.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = img.name;
        a.click();
        URL.revokeObjectURL(a.href);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== "AbortError") console.error("Batch download failed:", err);
  }
}

interface Job {
  id: number;
  batch_id: string | null;
  original_image: string;
  mockup_image: string | null;
  status: "pending" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
  updated_at?: string;
  username?: string;
  prompt_name?: string;
  prompt_mode?: string;
  group_role?: string;
  conversation_url?: string | null;
  previous_images?: string | null;
}

interface BatchGroup {
  key: string;
  original_image: string;
  created_at: string;
  jobs: Job[];
}

export default function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "admin") {
    return <AdminDashboard />;
  }
  return <UserDashboard />;
}

// ── Admin Dashboard ─────────────────────────────────────────
interface Stats {
  users: { total: number; mockup: number; trade: number };
  jobs: { total: number; today: number; pending: number; error: number };
  accounts: { total: number; free: number; busy: number; disabled: number };
}

function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [users, setUsers] = useState<{ id: number; username: string; role: string }[]>([]);
  const [showOriginal, setShowOriginal] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null);

  const fetchStats = useCallback(() => {
    api.get("/jobs/admin/stats").then((r) => setStats(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/users").then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  const fetchJobs = useCallback(() => {
    const params: Record<string, string | number> = { page, limit: 30 };
    if (filterRole) params.role = filterRole;
    if (filterStatus) params.status = filterStatus;
    if (filterUser) params.user_id = filterUser;
    api
      .get("/jobs", { params })
      .then((res) => {
        const body = res.data;
        setJobs(body.data || body);
        setTotalPages(body.pagination?.totalPages || 1);
      })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, [page, filterRole, filterStatus, filterUser]);

  useEffect(() => {
    fetchStats();
    const i = setInterval(fetchStats, 10000);
    return () => clearInterval(i);
  }, [fetchStats]);

  useEffect(() => {
    setLoadingJobs(true);
    fetchJobs();
    const i = setInterval(fetchJobs, 5000);
    return () => clearInterval(i);
  }, [fetchJobs]);

  // Fast-poll (2s) when any job is active
  const hasActiveJobs = jobs.some((j) => j.status === "pending" || j.status === "processing");
  useEffect(() => {
    if (!hasActiveJobs) return;
    const fast = setInterval(fetchJobs, 2000);
    return () => clearInterval(fast);
  }, [hasActiveJobs, fetchJobs]);

  useEffect(() => { setPage(1); }, [filterRole, filterStatus, filterUser]);

  const handleRetry = async (jobId: number) => {
    try { await api.post(`/jobs/${jobId}/retry`); fetchJobs(); fetchStats(); } catch { alert("Retry thất bại."); }
  };

  const handleDeleteBatch = async (batchKey: string) => {
    if (!confirm("Xóa batch này và tất cả ảnh liên quan?")) return;
    try {
      await api.delete(`/jobs/batch/${batchKey}`);
      fetchJobs();
      fetchStats();
    } catch {
      alert("Xóa thất bại.");
    }
  };

  // Group jobs by batch_id
  const batches = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      const key = job.batch_id || `single_${job.id}`;
      const arr = map.get(key) || [];
      arr.push(job);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, bJobs]) => ({
      key,
      original_image: bJobs[0].original_image,
      username: bJobs[0].username || "—",
      created_at: bJobs[0].created_at,
      jobs: bJobs,
      doneCount: bJobs.filter((j) => j.status === "done").length,
      errorCount: bJobs.filter((j) => j.status === "error").length,
    }));
  }, [jobs]);

  const statusCfg: Record<string, { label: string; cls: string }> = {
    pending: { label: "Chờ", cls: "bg-slate-100 text-slate-600" },
    processing: { label: "Đang xử lý", cls: "bg-blue-100 text-blue-600" },
    done: { label: "Hoàn tất", cls: "bg-green-100 text-green-700" },
    error: { label: "Lỗi", cls: "bg-red-100 text-red-600" },
  };

  const getBatchStatus = (b: typeof batches[0]) => {
    if (b.errorCount > 0) return statusCfg.error;
    if (b.doneCount === b.jobs.length) return statusCfg.done;
    if (b.jobs.some((j) => j.status === "processing")) return statusCfg.processing;
    return statusCfg.pending;
  };

  return (
    <ProtectedRoute>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Stats cards */}
        {stats && (
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon="👥" label="Users" value={stats.users.total} sub={`${stats.users.mockup} mockup · ${stats.users.trade} trade`} color="blue" />
            <StatCard icon="📋" label="Jobs hôm nay" value={stats.jobs.today} sub={`${stats.jobs.total} tổng`} color="indigo" />
            <StatCard icon="⏳" label="Đang xử lý" value={stats.jobs.pending} sub={stats.jobs.error > 0 ? `${stats.jobs.error} lỗi` : "Không lỗi"} color={stats.jobs.error > 0 ? "red" : "emerald"} />
            <StatCard icon="🤖" label="Gemini Accounts" value={`${stats.accounts.free}/${stats.accounts.total}`} sub={`${stats.accounts.busy} busy · ${stats.accounts.disabled} off`} color="amber" />
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Tất cả Jobs
          </h2>
          <div className="flex items-center gap-2">
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
              <option value="">Tất cả user</option>
              {users.filter((u) => u.role !== "admin").map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
              ))}
            </select>
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
              <option value="">Tất cả role</option>
              <option value="mockup">Mockup</option>
              <option value="trade">Trade</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Chờ</option>
              <option value="processing">Đang xử lý</option>
              <option value="done">Hoàn tất</option>
              <option value="error">Lỗi</option>
            </select>
            <button onClick={() => { fetchJobs(); fetchStats(); }} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100">↻ Refresh</button>
          </div>
        </div>

        {/* Batch list */}
        {loadingJobs ? (
          <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>
        ) : batches.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
            <p className="text-sm text-slate-400">Không có job nào.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => {
              const bStatus = getBatchStatus(batch);
              const isExpanded = expandedBatch === batch.key;
              return (
                <div key={batch.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {/* Batch header — clickable */}
                  <div
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                    onClick={() => setExpandedBatch(isExpanded ? null : batch.key)}
                  >
                    <img
                      src={`${API_BASE}/uploads/${batch.original_image}`}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-lg object-cover ring-offset-1 hover:ring-2 hover:ring-blue-400"
                      onClick={(e) => { e.stopPropagation(); setShowOriginal(`${API_BASE}/uploads/${batch.original_image}`); }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">{batch.username}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{batch.jobs.length} prompt{batch.jobs.length > 1 ? "s" : ""}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${bStatus.cls}`}>{bStatus.label}</span>
                        {batch.doneCount > 0 && batch.doneCount < batch.jobs.length && (
                          <span className="text-xs text-slate-400">{batch.doneCount}/{batch.jobs.length}</span>
                        )}
                        {batch.errorCount > 0 && (
                          <span className="text-xs text-red-500">{batch.errorCount} lỗi</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{formatTime(batch.created_at)}</p>
                    </div>
                    {batch.errorCount > 0 && (
                      <button
                        className="shrink-0 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-600 transition hover:bg-orange-100"
                        title="Tạo lại các job lỗi"
                        onClick={(e) => { e.stopPropagation(); const errJob = batch.jobs.find((j: Job) => j.status === 'error'); if (errJob) handleRetry(errJob.id); }}
                      >
                        Tạo lại
                      </button>
                    )}
                    <button
                      className="shrink-0 rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="Xóa batch"
                      onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batch.key); }}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                    <svg className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-100">
                      {(() => {
                        const mockupJobs = batch.jobs.filter((j: Job) => j.prompt_mode !== "line_drawing");
                        const lineJobs = batch.jobs.filter((j: Job) => j.prompt_mode === "line_drawing");
                        return (
                          <>
                            {mockupJobs.length > 0 && (
                              <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
                                {mockupJobs.map((job: Job) => (
                                  <div key={job.id} className="bg-white p-3">
                                    <BatchJobItem job={job} onRetry={handleRetry} onImageClick={(src, name) => setLightboxSrc({ src, name })} />
                                  </div>
                                ))}
                              </div>
                            )}
                            {lineJobs.length > 0 && (
                              <div className="grid gap-px bg-slate-100 grid-cols-1">
                                {lineJobs.map((job: Job) => (
                                  <div key={job.id} className="bg-white p-3">
                                    <BatchJobItemWide job={job} onRetry={handleRetry} onImageClick={(src, name) => setLightboxSrc({ src, name })} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-1">
            <button onClick={() => setPage(1)} disabled={page <= 1} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">‹</button>
            {(() => {
              const pages: number[] = [];
              const maxVisible = 5;
              let start = Math.max(1, page - Math.floor(maxVisible / 2));
              let end = Math.min(totalPages, start + maxVisible - 1);
              if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              return pages.map((p) => (
                <button key={p} onClick={() => setPage(p)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${p === page ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{p}</button>
              ));
            })()}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">›</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">»</button>
          </div>
        )}

        {showOriginal && (
          <ImageLightbox src={showOriginal} name="" onClose={() => setShowOriginal(null)} showDownload={false} />
        )}
        {lightboxSrc && (
          <ImageLightbox src={lightboxSrc.src} name={lightboxSrc.name} onClose={() => setLightboxSrc(null)} />
        )}
      </main>
    </ProtectedRoute>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-50 to-white border-blue-100",
    indigo: "from-indigo-50 to-white border-indigo-100",
    emerald: "from-emerald-50 to-white border-emerald-100",
    red: "from-red-50 to-white border-red-100",
    amber: "from-amber-50 to-white border-amber-100",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${colorMap[color] || colorMap.blue}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

// ── User Dashboard (mockup / trade) ────────────────────────
function UserDashboard() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null);

  const fetchJobs = useCallback(() => {
    api
      .get("/jobs", { params: { page, limit: 5 } })
      .then((res) => {
        const body = res.data;
        if (body.data) {
          setJobs(body.data);
          setTotalPages(body.pagination?.totalPages || 1);
        } else {
          setJobs(body);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, [page]);

  useEffect(() => {
    setLoadingJobs(true);
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Fast-poll (2s) when any job is active, so done images appear instantly
  const hasActiveJobs = jobs.some((j) => j.status === "pending" || j.status === "processing");
  useEffect(() => {
    if (!hasActiveJobs) return;
    const fast = setInterval(fetchJobs, 2000);
    return () => clearInterval(fast);
  }, [hasActiveJobs, fetchJobs]);

  // Group jobs by batch_id (or individual jobs without batch)
  const batches = useMemo<BatchGroup[]>(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      const key = job.batch_id || `single_${job.id}`;
      const group = map.get(key) || [];
      group.push(job);
      map.set(key, group);
    }
    return Array.from(map.entries()).map(([key, groupJobs]) => ({
      key,
      original_image: groupJobs[0].original_image,
      created_at: groupJobs[0].created_at,
      jobs: groupJobs,
    }));
  }, [jobs]);

  const handleFileSelect = (f: File) => {
    setFile(f);
    setFiles([]);
    setPreview(URL.createObjectURL(f));
    setPreviews([]);
  };

  const handleMultiFileSelect = (newFiles: File[]) => {
    if (newFiles.length === 1) {
      handleFileSelect(newFiles[0]);
      return;
    }
    setFile(null);
    setPreview(null);
    setFiles(newFiles);
    setPreviews(newFiles.map((f) => URL.createObjectURL(f)));
  };

  const handleClear = () => {
    setFile(null);
    setFiles([]);
    setPreview(null);
    setPreviews([]);
  };

  const handleSubmit = async () => {
    if ((!file && files.length === 0) || !groupId) return;
    setUploading(true);
    try {
      if (files.length > 1) {
        // Multi-image upload
        const formData = new FormData();
        for (const f of files) {
          formData.append("images", f);
        }
        formData.append("group_id", String(groupId));
        await api.post("/jobs/multi", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        // Single image upload
        const formData = new FormData();
        formData.append("image", file || files[0]);
        formData.append("group_id", String(groupId));
        await api.post("/jobs", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      handleClear();
      setGroupId(null);
      fetchJobs();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Lỗi không xác định";
      alert(`Tạo job thất bại: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async (jobId: number) => {
    try {
      await api.post(`/jobs/${jobId}/retry`);
      fetchJobs();
    } catch {
      alert("Retry thất bại.");
    }
  };

  const handleRegen = async (jobId: number, prompt: string) => {
    try {
      await api.post(`/jobs/${jobId}/regenerate`, { prompt });
      fetchJobs();
    } catch {
      alert("Tạo lại thất bại.");
    }
  };

  const handlePromote = async (jobId: number, index: number) => {
    try {
      await api.post(`/jobs/${jobId}/promote`, { index });
      fetchJobs();
    } catch {
      alert("Chuyển ảnh thất bại.");
    }
  };

  const pendingCount = jobs.filter(
    (j) => j.status === "pending" || j.status === "processing"
  ).length;

  return (
    <ProtectedRoute>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Upload section */}
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Tạo Job mới
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Ảnh gốc
              </label>
              <ImageUpload
                onFileSelect={handleFileSelect}
                onMultiFileSelect={handleMultiFileSelect}
                preview={preview}
                previews={previews}
                onClear={handleClear}
                multiple
              />
            </div>
            <div className="flex flex-col">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Chọn Chủ đề
                </label>
                <TopicSelector value={groupId} onChange={setGroupId} />
              </div>
              <button
                onClick={handleSubmit}
                disabled={(!file && files.length === 0) || !groupId || uploading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {uploading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Đang tải lên...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    Upload &amp; {user?.role === "trade" ? "Tạo Trade" : "Tạo Mockup"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Jobs history */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
              <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Lịch sử Jobs
              {pendingCount > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {pendingCount} đang xử lý
                </span>
              )}
            </h2>
            <button
              onClick={fetchJobs}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100"
            >
              ↻ Refresh
            </button>
          </div>

          {loadingJobs ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : batches.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
              <svg className="mx-auto mb-3 h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
              </svg>
              <p className="text-sm text-slate-400">Chưa có job nào. Upload ảnh để bắt đầu!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {batches.map((batch) => (
                <BatchCard
                  key={batch.key}
                  batch={batch}
                  onRetry={handleRetry}
                  onRegen={handleRegen}
                  onImageClick={(src, name) => setLightboxSrc({ src, name })}
                  onPromote={handlePromote}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <button onClick={() => setPage(1)} disabled={page <= 1} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">«</button>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">‹</button>
              {(() => {
                const pages: number[] = [];
                const maxVisible = 5;
                let start = Math.max(1, page - Math.floor(maxVisible / 2));
                let end = Math.min(totalPages, start + maxVisible - 1);
                if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
                for (let i = start; i <= end; i++) pages.push(i);
                return pages.map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${p === page ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{p}</button>
                ));
              })()}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">»</button>
            </div>
          )}
        </div>
      </main>
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          name={lightboxSrc.name}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </ProtectedRoute>
  );
}

const API_BASE = "";

// SQLite stores datetime('now') as UTC without 'Z' suffix.
// Append 'Z' so JS Date correctly interprets as UTC → converts to local timezone.
function formatTime(utcStr: string) {
  const d = new Date(utcStr.endsWith("Z") ? utcStr : utcStr + "Z");
  return d.toLocaleString("vi-VN", { hour12: false });
}

function BatchCard({
  batch,
  onRetry,
  onRegen,
  onImageClick,
  onPromote,
}: {
  batch: BatchGroup;
  onRetry: (id: number) => void;
  onRegen: (id: number, prompt: string) => Promise<void>;
  onImageClick?: (src: string, name: string) => void;
  onPromote?: (jobId: number, index: number) => void;
}) {
  const isBatch = batch.jobs.length > 1;
  const doneCount = batch.jobs.filter((j) => j.status === "done").length;
  const errorCount = batch.jobs.filter((j) => j.status === "error").length;
  const allDone = doneCount === batch.jobs.length;
  const doneJobs = batch.jobs.filter((j) => j.status === "done" && j.mockup_image);
  const [showOriginal, setShowOriginal] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [showPrev, setShowPrev] = useState(false);

  const handleDownloadAll = () => {
    const images = doneJobs.map((j) => ({
      url: `${API_BASE}/outputs-hd/${j.mockup_image}?size=2048`,
      name: j.mockup_image!.replace(/(\.[^.]+)$/, '_2K$1'),
    }));
    downloadBatchToFolder(images);
  };

  // Single job → 2-column layout: original | output
  if (!isBatch) {
    const job = batch.jobs[0];
    const cfg = statusConfig[job.status] || statusConfig.pending;
    const prevImages: { image: string; at: string }[] = job.previous_images ? (() => { try { return JSON.parse(job.previous_images); } catch { return []; } })() : [];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-400">#{job.id}</span>
            {job.prompt_name && <span className="truncate text-xs font-medium text-indigo-500" title={job.prompt_name}>{job.prompt_name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
            {job.status === "processing" && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />}
          </div>
        </div>
        {/* 2-column: original + output */}
        <div className="grid grid-cols-2 gap-px bg-slate-100">
          <div className="bg-white p-2">
            <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">Ảnh gốc</p>
            <button type="button" className="w-full cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/uploads/${batch.original_image}`, batch.original_image)}>
              <img src={`${API_BASE}/uploads/${batch.original_image}`} alt="" className="aspect-square w-full rounded-lg object-cover transition hover:opacity-80" loading="lazy" />
            </button>
          </div>
          <div className="bg-white p-2">
            <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
              {job.group_role === "trade" ? "Trade" : job.prompt_mode === "line_drawing" ? "Line Drawing" : "Mockup"}
            </p>
            {job.mockup_image ? (
              <div className="relative">
                <button type="button" className="w-full cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`, job.mockup_image || `job_${job.id}`)}>
                  <img src={`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`} alt="" className="aspect-square w-full rounded-lg object-cover transition hover:opacity-80" loading="lazy" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadSingleImage(`${API_BASE}/outputs-hd/${job.mockup_image}?size=2048`, job.mockup_image!.replace(/(\.[^.]+)$/, '_2K$1')); }}
                  className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-white"
                  title="Tải 2K"
                >
                  <svg className="h-3.5 w-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                </button>
              </div>
            ) : job.status === "processing" ? (
              <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-blue-50/70">
                <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-blue-500 border-t-transparent" />
                <span className="text-[11px] font-medium text-blue-500">Đang tạo ảnh...</span>
              </div>
            ) : job.status === "pending" ? (
              <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-slate-50">
                <svg className="h-7 w-7 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-[11px] font-medium text-slate-400">Đang chờ...</span>
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-50">
                <svg className="h-5 w-5 text-slate-200" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" /></svg>
              </div>
            )}
          </div>
        </div>
        {/* Footer: error/retry + regen + previous images */}
        <div className="px-4 py-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{formatTime(batch.created_at)}</span>
            {job.status === "error" && (
              <div className="flex items-center gap-2">
                <span className="max-w-[200px] truncate text-red-500" title={job.error || ""}>{job.error}</span>
                <button onClick={() => onRetry(job.id)} className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100">Thử lại</button>
              </div>
            )}
          </div>
          {onRegen && job.status === "done" && (
            <div className="mt-2 flex gap-1">
              <input
                type="text"
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="Yêu cầu tạo lại..."
                className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 placeholder-slate-300 focus:border-blue-400 focus:outline-none"
                disabled={regenLoading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && regenPrompt.trim()) {
                    setRegenLoading(true);
                    onRegen(job.id, regenPrompt.trim()).finally(() => { setRegenLoading(false); setRegenPrompt(""); });
                  }
                }}
              />
              <button
                onClick={() => { if (!regenPrompt.trim()) return; setRegenLoading(true); onRegen(job.id, regenPrompt.trim()).finally(() => { setRegenLoading(false); setRegenPrompt(""); }); }}
                disabled={regenLoading || !regenPrompt.trim()}
                className="shrink-0 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
              >
                {regenLoading ? "..." : "Tạo lại"}
              </button>
            </div>
          )}
          {prevImages.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowPrev(!showPrev)} className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600">
                <svg className={`h-3 w-3 transition-transform ${showPrev ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                Ảnh trước ({prevImages.length})
              </button>
              {showPrev && (
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {prevImages.map((p: { image: string; at: string }, i: number) => (
                    <div key={i} className="relative">
                      <button type="button" className="w-full cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${p.image}`, p.image)}>
                        <img src={`${API_BASE}/outputs/${p.image}`} alt="" className="aspect-square w-full rounded border border-slate-200 object-cover opacity-70 hover:opacity-100" loading="lazy" />
                      </button>
                      <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white">{formatTime(p.at)}</span>
                      {onPromote && (
                        <button onClick={() => onPromote(job.id, i)} className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow text-[10px] text-blue-600 hover:bg-blue-100" title="Dùng ảnh này">↑</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Batch → grouped display
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Batch header */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <img
          src={`${API_BASE}/uploads/${batch.original_image}`}
          alt=""
          className="h-12 w-12 shrink-0 cursor-pointer rounded-lg object-cover ring-offset-1 transition hover:ring-2 hover:ring-blue-400"
          onClick={() => setShowOriginal(true)}
          title="Xem ảnh gốc"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              {batch.jobs.length} prompts
            </span>
            {allDone ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Hoàn tất
              </span>
            ) : (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {doneCount}/{batch.jobs.length} xong
                {errorCount > 0 && ` • ${errorCount} lỗi`}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {formatTime(batch.created_at)}
          </p>
        </div>
        {errorCount > 0 && (
          <button
            onClick={() => { const errJob = batch.jobs.find((j) => j.status === 'error'); if (errJob) onRetry(errJob.id); }}
            className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-600 transition hover:bg-orange-100"
            title="Tạo lại các job lỗi"
          >
            Tạo lại ({errorCount})
          </button>
        )}
        {doneJobs.length > 0 && (
          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700"
            title="Tải tất cả ảnh đã hoàn tất"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Tải tất cả ({doneJobs.length})
          </button>
        )}
      </div>

      {/* Jobs grid inside batch */}
      {(() => {
        const mockupJobs = batch.jobs.filter((j) => j.prompt_mode !== "line_drawing");
        const lineJobs = batch.jobs.filter((j) => j.prompt_mode === "line_drawing");
        return (
          <>
            {mockupJobs.length > 0 && (
              <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
                {mockupJobs.map((job) => (
                  <BatchJobItem key={job.id} job={job} onRetry={onRetry} onRegen={onRegen} onImageClick={onImageClick} onPromote={onPromote} />
                ))}
              </div>
            )}
            {lineJobs.length > 0 && (
              <div className="grid gap-px bg-slate-100 grid-cols-1">
                {lineJobs.map((job) => (
                  <BatchJobItemWide key={job.id} job={job} onRetry={onRetry} onRegen={onRegen} onImageClick={onImageClick} onPromote={onPromote} />
                ))}
              </div>
            )}
          </>
        );
      })()}

      {showOriginal && (
        <ImageLightbox
          src={`${API_BASE}/uploads/${batch.original_image}`}
          name={batch.original_image}
          onClose={() => setShowOriginal(false)}
          showDownload={false}
        />
      )}
    </div>
  );
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Chờ", color: "text-slate-600", bg: "bg-slate-100" },
  processing: { label: "Xử lý", color: "text-blue-600", bg: "bg-blue-100" },
  done: { label: "Xong", color: "text-green-600", bg: "bg-green-100" },
  error: { label: "Lỗi", color: "text-red-600", bg: "bg-red-100" },
};

function BatchJobItem({ job, onRetry, onRegen, onImageClick, onPromote }: { job: Job; onRetry: (id: number) => void; onRegen?: (id: number, prompt: string) => Promise<void>; onImageClick?: (src: string, name: string) => void; onPromote?: (jobId: number, index: number) => void }) {
  const cfg = statusConfig[job.status] || statusConfig.pending;
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [showPrev, setShowPrev] = useState(false);
  const prevImages: { image: string; at: string }[] = job.previous_images ? JSON.parse(job.previous_images) : [];
  return (
    <div className="bg-white p-3">
      {/* Prompt name + status */}
      <div className="mb-2 flex items-center justify-between">
        <span className="truncate text-xs font-medium text-slate-600" title={job.prompt_name}>
          {job.prompt_name || `Prompt #${job.id}`}
        </span>
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {job.status === "processing" && (
            <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-600 border-t-transparent" />
          )}
        </div>
      </div>
      {/* Image */}
      <div>
        {job.mockup_image ? (
          <div className="relative">
            <button type="button" className="w-full cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`, job.mockup_image || `job_${job.id}`)}>
              <img src={`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`} alt="" className="aspect-square w-full rounded object-cover hover:opacity-80" loading="lazy" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadSingleImage(`${API_BASE}/outputs-hd/${job.mockup_image}?size=2048`, job.mockup_image!.replace(/(\.[^.]+)$/, '_2K$1'));
              }}
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-white"
              title="Tải 2K"
            >
              <svg className="h-3.5 w-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>
          </div>
        ) : job.status === "processing" ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded bg-blue-50/70">
            <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-blue-500 border-t-transparent" />
            <span className="text-[11px] font-medium text-blue-500">Đang tạo ảnh...</span>
          </div>
        ) : job.status === "pending" ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded bg-slate-50">
            <svg className="h-7 w-7 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[11px] font-medium text-slate-400">Đang chờ...</span>
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded bg-slate-50">
            <svg className="h-5 w-5 text-slate-200" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
            </svg>
          </div>
        )}
      </div>
      {/* Error + retry */}
      {job.status === "error" && (
        <div className="mt-2 flex items-center justify-between">
          <span className="max-w-[120px] truncate text-[10px] text-red-500" title={job.error || ""}>
            {job.error}
          </span>
          <button
            onClick={() => onRetry(job.id)}
            className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-100"
          >
            Thử lại
          </button>
        </div>
      )}
      {/* Regen UI */}
      {job.status === "done" && onRegen && (
        <div className="mt-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              placeholder="Yêu cầu tạo lại..."
              className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 placeholder-slate-300 focus:border-blue-400 focus:outline-none"
              disabled={regenLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && regenPrompt.trim()) {
                  setRegenLoading(true);
                  onRegen(job.id, regenPrompt.trim()).finally(() => {
                    setRegenLoading(false);
                    setRegenPrompt("");
                  });
                }
              }}
            />
            <button
              onClick={() => {
                if (!regenPrompt.trim()) return;
                setRegenLoading(true);
                onRegen(job.id, regenPrompt.trim()).finally(() => {
                  setRegenLoading(false);
                  setRegenPrompt("");
                });
              }}
              disabled={regenLoading || !regenPrompt.trim()}
              className="shrink-0 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
            >
              {regenLoading ? "..." : "Tạo lại"}
            </button>
          </div>
        </div>
      )}
      {/* Previous images dropdown */}
      {prevImages.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowPrev(!showPrev)}
            className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600"
          >
            <svg className={`h-3 w-3 transition-transform ${showPrev ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            Ảnh trước ({prevImages.length})
          </button>
          {showPrev && (
            <div className="mt-1.5 space-y-1.5">
              {prevImages.map((p, i) => (
                <div key={i} className="relative">
                  <button type="button" className="w-full cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${p.image}`, p.image)}>
                    <img src={`${API_BASE}/outputs/${p.image}`} alt="" className="aspect-square w-full rounded border border-slate-200 object-cover opacity-70 hover:opacity-100" loading="lazy" />
                  </button>
                  <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white">{formatTime(p.at)}</span>
                  {onPromote && (
                    <button
                      onClick={() => onPromote(job.id, i)}
                      className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow text-[10px] text-blue-600 hover:bg-blue-100"
                      title="Dùng ảnh này"
                    >↑</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BatchJobItemWide({ job, onRetry, onRegen, onImageClick, onPromote }: { job: Job; onRetry: (id: number) => void; onRegen?: (id: number, prompt: string) => Promise<void>; onImageClick?: (src: string, name: string) => void; onPromote?: (jobId: number, index: number) => void }) {
  const cfg = statusConfig[job.status] || statusConfig.pending;
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [showPrev, setShowPrev] = useState(false);
  const prevImages: { image: string; at: string }[] = job.previous_images ? JSON.parse(job.previous_images) : [];
  return (
    <div className="flex items-center gap-4 bg-white p-4">
      {/* Info */}
      <div className="w-44 shrink-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-700" title={job.prompt_name}>
            {job.prompt_name || `Prompt #${job.id}`}
          </span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-500">Line Drawing</p>
        {job.status === "error" && (
          <div className="mt-2">
            <span className="block truncate text-[10px] text-red-500" title={job.error || ""}>{job.error}</span>
            <button onClick={() => onRetry(job.id)} className="mt-1 rounded bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-100">Thử lại</button>
          </div>
        )}
      </div>
      {/* Image — landscape, larger */}
      <div className="flex-1">
        {job.mockup_image ? (
          <div className="relative inline-block">
            <button type="button" className="cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`, job.mockup_image || `job_${job.id}`)}>
              <img src={`${API_BASE}/outputs/${job.mockup_image}?v=${job.updated_at || ''}`} alt="" className="max-h-64 rounded-lg object-contain hover:opacity-80" loading="lazy" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadSingleImage(`${API_BASE}/outputs-hd/${job.mockup_image}?size=2048`, job.mockup_image!.replace(/(\.[^.]+)$/, '_2K$1'));
              }}
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-white"
              title="Tải 2K"
            >
              <svg className="h-3.5 w-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>
          </div>
        ) : job.status === "processing" ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg bg-blue-50/70">
            <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-blue-500 border-t-transparent" />
            <span className="text-[11px] font-medium text-blue-500">Đang tạo ảnh...</span>
          </div>
        ) : job.status === "pending" ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg bg-slate-50">
            <svg className="h-7 w-7 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[11px] font-medium text-slate-400">Đang chờ...</span>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center rounded-lg bg-slate-50">
            <svg className="h-5 w-5 text-slate-200" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
            </svg>
          </div>
        )}
      </div>
      {/* Regen UI */}
      {job.status === "done" && onRegen && (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={regenPrompt}
            onChange={(e) => setRegenPrompt(e.target.value)}
            placeholder="Yêu cầu tạo lại..."
            className="w-48 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 placeholder-slate-300 focus:border-blue-400 focus:outline-none"
            disabled={regenLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && regenPrompt.trim()) {
                setRegenLoading(true);
                onRegen(job.id, regenPrompt.trim()).finally(() => {
                  setRegenLoading(false);
                  setRegenPrompt("");
                });
              }
            }}
          />
          <button
            onClick={() => {
              if (!regenPrompt.trim()) return;
              setRegenLoading(true);
              onRegen(job.id, regenPrompt.trim()).finally(() => {
                setRegenLoading(false);
                setRegenPrompt("");
              });
            }}
            disabled={regenLoading || !regenPrompt.trim()}
            className="shrink-0 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
          >
            {regenLoading ? "..." : "Tạo lại"}
          </button>
        </div>
      )}
      {/* Previous images dropdown */}
      {prevImages.length > 0 && (
        <div className="shrink-0">
          <button
            onClick={() => setShowPrev(!showPrev)}
            className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600"
          >
            <svg className={`h-3 w-3 transition-transform ${showPrev ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            Ảnh trước ({prevImages.length})
          </button>
          {showPrev && (
            <div className="mt-1.5 flex gap-2">
              {prevImages.map((p, i) => (
                <div key={i} className="relative">
                  <button type="button" className="cursor-zoom-in" onClick={() => onImageClick?.(`${API_BASE}/outputs/${p.image}`, p.image)}>
                    <img src={`${API_BASE}/outputs/${p.image}`} alt="" className="h-20 rounded border border-slate-200 object-contain opacity-70 hover:opacity-100" loading="lazy" />
                  </button>
                  {onPromote && (
                    <button
                      onClick={() => onPromote(job.id, i)}
                      className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow text-[10px] text-blue-600 hover:bg-blue-100"
                      title="Dùng ảnh này"
                    >↑</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
