"use client";

import { useState } from "react";
import ImageLightbox from "@/components/ImageLightbox";

const API_BASE = "";

function formatTime(utcStr: string) {
  const d = new Date(utcStr.endsWith("Z") ? utcStr : utcStr + "Z");
  return d.toLocaleString("vi-VN", { hour12: false });
}

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

interface Job {
  id: number;
  batch_id: string | null;
  original_image: string;
  mockup_image: string | null;
  status: "pending" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
  username?: string;
  prompt_name?: string;
  prompt_mode?: string;
  group_role?: string;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Đang chờ", color: "text-slate-600", bg: "bg-slate-100" },
  processing: { label: "Đang xử lý", color: "text-blue-600", bg: "bg-blue-100" },
  done: { label: "Hoàn tất", color: "text-green-600", bg: "bg-green-100" },
  error: { label: "Lỗi", color: "text-red-600", bg: "bg-red-100" },
};

export default function JobCard({
  job,
  onRetry,
}: {
  job: Job;
  onRetry?: (id: number) => void;
}) {
  const cfg = statusConfig[job.status] || statusConfig.pending;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">#{job.id}</span>
          {job.prompt_name && (
            <span className="truncate text-xs font-medium text-indigo-500" title={job.prompt_name}>{job.prompt_name}</span>
          )}
          {job.username && (
            <span className="text-xs text-slate-400">• {job.username}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {job.status === "processing" && (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          )}
        </div>
      </div>

      {/* Images grid */}
      <div className="grid grid-cols-2 gap-px bg-slate-100">
        {/* Original */}
        <div className="bg-white p-2">
          <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Ảnh gốc
          </p>
          <ImageThumb src={`${API_BASE}/uploads/${job.original_image}`} />
        </div>
        {/* Output */}
        <div className="bg-white p-2">
          <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {job.group_role === "trade" ? "DrawLine" : job.prompt_mode === "line_drawing" ? "Line Drawing" : "Mockup"}
          </p>
          {job.mockup_image ? (
            <div className="relative">
              <a href={`${API_BASE}/outputs/${job.mockup_image}`} target="_blank" rel="noopener noreferrer">
                <img
                  src={`${API_BASE}/outputs/${job.mockup_image}`}
                  alt=""
                  className="aspect-square w-full rounded-lg object-cover transition hover:opacity-80"
                  loading="lazy"
                />
              </a>
              <button
                onClick={() => {
                  const ext = job.mockup_image!.split(".").pop() || "png";
                  const safeName = (job.prompt_name || `job_${job.id}`).replace(/[<>:"/\\|?*]/g, "_");
                  downloadSingleImage(`${API_BASE}/outputs/${job.mockup_image}`, `${safeName}.${ext}`);
                }}
                className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-white"
                title="Tải xuống"
              >
                <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
            </div>
          ) : (
            <Placeholder />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-400">
        <span>{formatTime(job.created_at)}</span>
        {job.status === "error" && (
          <div className="flex items-center gap-2">
            <span className="max-w-[200px] truncate text-red-500" title={job.error || ""}>
              {job.error}
            </span>
            {onRetry && (
              <button
                onClick={() => onRetry(job.id)}
                className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
              >
                Thử lại
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageThumb({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        src={src}
        alt=""
        className="aspect-square w-full cursor-pointer rounded-lg object-cover transition hover:opacity-80"
        loading="lazy"
        onClick={() => setOpen(true)}
      />
      {open && (
        <ImageLightbox
          src={src}
          name=""
          onClose={() => setOpen(false)}
          showDownload={false}
        />
      )}
    </>
  );
}

function Placeholder() {
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-slate-50">
      <svg className="h-6 w-6 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
      </svg>
    </div>
  );
}
