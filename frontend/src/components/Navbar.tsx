"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

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
      : []),
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
    </nav>
  );
}
