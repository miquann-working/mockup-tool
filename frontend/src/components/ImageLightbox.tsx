"use client";

import { useEffect, useState, useRef, useCallback } from "react";

const API_BASE = "";

async function downloadImage(url: string, suggestedName: string) {
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

interface ImageLightboxProps {
  src: string;
  name: string;
  onClose: () => void;
  showDownload?: boolean;
}

export default function ImageLightbox({ src, name, onClose, showDownload = true }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const resetTransform = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setScale((prev) => {
      const next = prev - e.deltaY * 0.001;
      return Math.min(Math.max(next, 0.25), 8);
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
  }, [scale, translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setTranslate({
      x: translateStart.current.x + (e.clientX - dragStart.current.x),
      y: translateStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleBackdropClick = useCallback(() => {
    if (scale > 1) {
      resetTransform();
    } else {
      onClose();
    }
  }, [scale, resetTransform, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
        ref={containerRef}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-slate-100"
        >
          <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Zoom controls */}
        <div className="absolute -left-3 top-0 z-10 flex flex-col gap-1">
          <button
            onClick={() => setScale((s) => Math.min(s + 0.5, 8))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-slate-100 text-slate-600 font-bold text-lg"
          >+</button>
          <button
            onClick={() => setScale((s) => Math.max(s - 0.5, 0.25))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-slate-100 text-slate-600 font-bold text-lg"
          >−</button>
          {scale !== 1 && (
            <button
              onClick={resetTransform}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-slate-100 text-slate-600 text-xs font-medium"
              title="Reset zoom"
            >1:1</button>
          )}
        </div>

        {/* Scale indicator */}
        {scale !== 1 && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {Math.round(scale * 100)}%
          </div>
        )}

        {/* Image */}
        <div
          className="overflow-hidden rounded-lg"
          onWheel={handleWheel}
          style={{ maxHeight: "80vh", maxWidth: "85vw" }}
        >
          <img
            src={src}
            alt=""
            className="shadow-2xl select-none"
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              transformOrigin: "center center",
              cursor: scale > 1 ? (isDragging.current ? "grabbing" : "grab") : "zoom-in",
              maxHeight: "80vh",
              maxWidth: "85vw",
              objectFit: "contain",
            }}
            onMouseDown={handleMouseDown}
            draggable={false}
          />
        </div>

        {/* Download button */}
        {showDownload && (
          <button
            onClick={() => {
              if (src.includes("/outputs/")) {
                const hdUrl = src.replace("/outputs/", "/outputs-hd/").split("?")[0] + "?size=2048";
                const hdName = name.replace(/(\.[^.]+)$/, '_2K$1');
                downloadImage(hdUrl, hdName);
              } else {
                downloadImage(src, name);
              }
            }}
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-blue-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Tải xuống (2K)
          </button>
        )}
      </div>
    </div>
  );
}

export { API_BASE, downloadImage };
