"use client";

import { useCallback, useState } from "react";

interface ImageUploadProps {
  onFileSelect: (file: File) => void;
  onMultiFileSelect?: (files: File[]) => void;
  preview: string | null;
  previews?: string[];
  onClear: () => void;
  multiple?: boolean;
}

export default function ImageUpload({ onFileSelect, onMultiFileSelect, preview, previews, onClear, multiple }: ImageUploadProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (multiple && onMultiFileSelect && files.length > 0) {
        onMultiFileSelect(files);
      } else if (files[0]) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect, onMultiFileSelect, multiple]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (multiple && onMultiFileSelect && files.length > 0) {
      onMultiFileSelect(files);
    } else if (files[0]) {
      onFileSelect(files[0]);
    }
  };

  // Multi-preview
  if (previews && previews.length > 0) {
    return (
      <div className="relative overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap gap-2">
          {previews.map((src, i) => (
            <img key={i} src={src} alt="" className="h-24 w-24 rounded-lg object-cover" />
          ))}
        </div>
        <div className="mt-2 text-center text-xs text-slate-500">{previews.length} ảnh đã chọn</div>
        <button
          onClick={onClear}
          className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition hover:bg-black/80"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  if (preview) {
    return (
      <div className="relative overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50">
        <img
          src={preview}
          alt="Preview"
          className="mx-auto max-h-72 object-contain p-2"
        />
        <button
          onClick={onClear}
          className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition hover:bg-black/80"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
        dragActive
          ? "border-blue-400 bg-blue-50"
          : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"
      }`}
    >
      <svg
        className={`mb-3 h-10 w-10 ${dragActive ? "text-blue-500" : "text-slate-400"}`}
        fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      <p className="text-sm font-medium text-slate-600">
        Kéo thả ảnh vào đây hoặc <span className="text-blue-600">chọn file</span>
      </p>
      <p className="mt-1 text-xs text-slate-400">Mọi định dạng ảnh — tối đa 20MB</p>
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
    </label>
  );
}
