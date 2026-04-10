"use client";

import { useEffect, useState, useMemo } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Prompt {
  id: number;
  name: string;
}

interface PromptGroup {
  id: number;
  name: string;
  owner_name?: string;
  user_id?: number;
  prompts: Prompt[];
}

interface TopicSelectorProps {
  value: number | null;
  onChange: (groupId: number | null) => void;
}

export default function TopicSelector({ value, onChange }: TopicSelectorProps) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState("all");

  useEffect(() => {
    api
      .get("/prompt-groups", { params: { limit: 200 } })
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : res.data.data || [];
        setGroups(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Unique owners for the dropdown
  const owners = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((g) => {
      if (g.user_id && g.owner_name) map.set(g.user_id, g.owner_name);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [groups]);

  const filtered = useMemo(() => {
    let list = groups;
    if (filterOwner === "mine" && user) {
      list = list.filter((g) => g.user_id === user.id);
    } else if (filterOwner !== "all") {
      const ownerId = Number(filterOwner);
      list = list.filter((g) => g.user_id === ownerId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q));
    }
    return list;
  }, [groups, search, filterOwner, user]);

  const selectedGroup = groups.find((g) => g.id === value);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-10 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-12 animate-pulse rounded-lg bg-slate-200" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        Chưa có chủ đề nào.
      </div>
    );
  }

  return (
    <div>
      {/* Filter dropdown + Search row */}
      <div className="mb-2 flex items-center gap-2">
        <select
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="all">Tất cả</option>
          <option value="mine">Của tôi</option>
          {owners.map((o) => (
            user && o.id === user.id ? null : (
              <option key={o.id} value={o.id}>{o.name}</option>
            )
          ))}
        </select>
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm chủ đề..."
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-7 pr-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {/* Vertical list */}
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">Không tìm thấy chủ đề</p>
        ) : (
          filtered.map((g, i) => {
            const selected = value === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onChange(selected ? null : g.id)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
                  i > 0 ? "border-t border-slate-100" : ""
                } ${
                  selected
                    ? "bg-blue-50"
                    : "bg-white hover:bg-slate-50"
                }`}
              >
                {/* Check icon */}
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  selected ? "bg-blue-600 text-white" : "border border-slate-300 text-transparent"
                }`}>
                  ✓
                </span>
                {/* Name */}
                <span className={`flex-1 truncate text-xs font-medium ${selected ? "text-blue-700" : "text-slate-700"}`}>
                  {g.name}
                </span>
                {/* Prompt count */}
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  selected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {g.prompts.length} góc
                </span>
                {/* Owner – only show for other people's prompts */}
                {g.owner_name && g.user_id !== user?.id && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    selected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    {g.owner_name}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Selected indicator */}
      {selectedGroup && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5">
          <span className="text-xs text-blue-600">Đã chọn:</span>
          <span className="text-xs font-semibold text-blue-700">{selectedGroup.name}</span>
          <span className="text-[10px] text-blue-500">({selectedGroup.prompts.length} góc)</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto text-blue-400 hover:text-blue-600"
            title="Bỏ chọn"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
