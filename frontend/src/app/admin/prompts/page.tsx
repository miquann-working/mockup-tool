"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPromptsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/prompts");
  }, [router]);
  return (
    <div className="flex justify-center py-12">
      <p className="text-sm text-slate-400">Đang chuyển hướng...</p>
    </div>
  );
}
