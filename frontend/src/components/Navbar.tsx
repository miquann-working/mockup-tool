"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [expiredAlerts, setExpiredAlerts] = useState<{ id: number; email: string }[]>([]);
  const lastCheckRef = useRef(new Date().toISOString());

  // Poll for expired session alerts (admin only)
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    const check = () => {
      api.get("/accounts/expired-recent", { params: { since: lastCheckRef.current } })
        .then((r) => {
          if (r.data.length > 0) {
            setExpiredAlerts((prev) => {
              const existingIds = new Set(prev.map((a) => a.id));
              const newAlerts = r.data.filter((a: { id: number }) => !existingIds.has(a.id));
              return [...newAlerts, ...prev].slice(0, 10);
            });
          }
          lastCheckRef.current = new Date().toISOString();
        })
        .catch(() => {});
    };
    check();
    const i = setInterval(check, 15_000);
    return () => clearInterval(i);
  }, [user]);

  if (!user) return null;

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/prompts", label: "Quản lý Prompts" },
    ...(user.role === "admin"
      ? [
          { href: "/admin/accounts", label: "Accounts" },
          { href: "/admin/users", label: "Users" },
          { href: "/admin/vps", label: "VPS" },
        ]
      : [
          { href: "/vps", label: "VPS" },
        ]),
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className="mr-4 flex items-center gap-2 text-lg font-bold text-slate-800"
          >
            <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
            </svg>
            <span className="hidden sm:inline">
              {user.role === "admin" ? "Smazing ADMIN" : user.role === "trade" ? "Smazing Trade" : "Smazing Mockup"}
            </span>
          </Link>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
              {user.username[0].toUpperCase()}
            </div>
            <span className="hidden text-sm text-slate-600 sm:inline">
              {user.username}
              {user.role !== "admin" && (
                <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                  user.role === "trade" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                }`}>
                  {user.role === "trade" ? "Trade" : "Mockup"}
                </span>
              )}
              {user.role === "admin" && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                  Admin
                </span>
              )}
            </span>
          </div>
          <button
            onClick={logout}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            Đăng xuất
          </button>
        </div>
      </div>
      {/* Session expiry toast notifications */}
      {expiredAlerts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {expiredAlerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 shadow-lg animate-in slide-in-from-right"
            >
              <span className="text-lg">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-red-800">Session hết hạn</p>
                <p className="text-xs text-red-600">{alert.email}</p>
              </div>
              <button
                onClick={() => setExpiredAlerts((prev) => prev.filter((a) => a.id !== alert.id))}
                className="ml-2 rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
