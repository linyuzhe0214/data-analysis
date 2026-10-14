import React, { useState } from "react";
import { PlusCircle, Trash2, ChevronDown, ChevronUp, ShieldOff } from "lucide-react";

export interface ExemptZone {
  id: string;
  route: string;
  direction: string;
  type: "point" | "range";
  mileage?: number;
  start?: number;
  end?: number;
  label?: string;
}

/** 將公里數格式化為 23k+000 或 23k+100 格式 */
export const formatMileage = (km: number | undefined | null): string => {
  if (km == null || isNaN(km)) return "0k+000";
  const totalM = Math.round(km * 1000);
  const k = Math.floor(totalM / 1000);
  const m = Math.abs(totalM % 1000);
  return `${k}k+${String(m).padStart(3, "0")}`;
};

/** 解析使用者輸入的里程字串（支援 23100 -> 23.1, 23k+100 -> 23.1, 23.1 -> 23.1, 23 -> 23.0） */
export const parseMileageInput = (raw: string | number): number => {
  if (typeof raw === "number") {
    return raw >= 1000 ? raw / 1000 : raw;
  }
  if (!raw) return NaN;
  const s = String(raw).trim();

  // 1. 匹配 23k+100, 23K+100, 23k100, 23+100, K23+100
  const kPlusMatch = s.match(/(?:[kK]?\s*(\d+))\s*(?:[kK]|\+|\+0*)\s*(\d+)/);
  if (kPlusMatch) {
    const k = parseInt(kPlusMatch[1], 10);
    const m = parseInt(kPlusMatch[2], 10);
    return k + m / 1000;
  }

  // 2. 匹配 K160, K23.1 等前面帶 K
  const kPrefixMatch = s.match(/^[kK]\s*([0-9.]+)/);
  if (kPrefixMatch) {
    const val = parseFloat(kPrefixMatch[1]);
    return val >= 1000 ? val / 1000 : val;
  }

  // 3. 一般數值
  const num = parseFloat(s);
  if (isNaN(num)) return NaN;

  // 若使用者輸入整數大於等於 1000 (例如 23100, 23000, 160500) 且無小數點，視為公尺 (m) -> 轉為公里 (km)
  if (!s.includes(".") && num >= 1000) {
    return num / 1000;
  }

  return num;
};

interface Props {
  zones: ExemptZone[];
  routes: string[];
  directions: string[];
  onChange: (zones: ExemptZone[]) => void;
}

export function ExemptZoneManager({ zones, routes, directions, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"point" | "range">("range");
  const [route, setRoute] = useState(routes[0] || "");
  const [direction, setDirection] = useState("");
  const [mileage, setMileage] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");

  const add = () => {
    setErr("");
    if (!route) { setErr("請選擇路線"); return; }
    if (type === "point") {
      const parts = mileage.split(/[\s,，、\n]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) { setErr("請輸入有效里程"); return; }
      const newItems: ExemptZone[] = [];
      for (const p of parts) {
        const m = parseMileageInput(p);
        if (isNaN(m)) { setErr(`里程「${p}」無法識別（支援例：23100 或 23k+100 或 23.1）`); return; }
        newItems.push({ id: crypto.randomUUID(), route, direction, type: "point", mileage: m, label });
      }
      onChange([...zones, ...newItems]);
      setMileage("");
    } else {
      const s = parseMileageInput(start);
      const e = parseMileageInput(end);
      if (isNaN(s) || isNaN(e)) { setErr("請輸入有效起迄里程（支援例：23000、23k+000 或 23.0）"); return; }
      if (s === e) { setErr("起點與終點里程不可相同（如為單一位置請選「單點」）"); return; }
      const [minK, maxK] = s < e ? [s, e] : [e, s];
      onChange([...zones, { id: crypto.randomUUID(), route, direction, type: "range", start: minK, end: maxK, label }]);
      setStart(""); setEnd("");
    }
    setLabel("");
  };

  const clearAll = () => {
    onChange([]);
  };

  const remove = (id: string) => onChange(zones.filter(z => z.id !== id));

  const dirsForRoute = ["（全方向）", ...directions.filter(d => d !== "雙向")];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        id="btn-toggle-exempt-manager"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-50 rounded-lg">
            <ShieldOff className="w-4 h-4 text-amber-600" />
          </div>
          <span className="text-sm font-bold text-slate-800">免測路段管理</span>
          {zones.length > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
              {zones.length} 條規則
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
                <button
                  id="btn-exempt-type-range"
                  type="button"
                  onClick={() => setType("range")}
                  className={`px-3 py-1.5 transition-colors cursor-pointer ${type === "range" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                >範圍</button>
                <button
                  id="btn-exempt-type-point"
                  type="button"
                  onClick={() => setType("point")}
                  className={`px-3 py-1.5 transition-colors cursor-pointer ${type === "point" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                >單點 (支援多點)</button>
              </div>
              <select
                id="select-exempt-route"
                value={route}
                onChange={e => setRoute(e.target.value)}
                className="border border-slate-200 bg-white rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none cursor-pointer"
              >
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                id="select-exempt-direction"
                value={direction || "（全方向）"}
                onChange={e => setDirection(e.target.value === "（全方向）" ? "" : e.target.value)}
                className="border border-slate-200 bg-white rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none cursor-pointer"
              >
                {dirsForRoute.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="flex gap-2 flex-wrap items-center">
              {type === "point" ? (
                <input
                  id="input-exempt-point-mileage"
                  type="text"
                  placeholder="里程 (例: 23100 或 23k+100，支援逗號多筆)"
                  value={mileage}
                  onChange={e => setMileage(e.target.value)}
                  className="flex-1 min-w-[220px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                />
              ) : (
                <>
                  <input
                    id="input-exempt-start-mileage"
                    type="text"
                    placeholder="起點 (例: 23100 或 23k+100)"
                    value={start}
                    onChange={e => setStart(e.target.value)}
                    className="flex-1 min-w-[140px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-slate-400 text-xs">～</span>
                  <input
                    id="input-exempt-end-mileage"
                    type="text"
                    placeholder="終點 (例: 24000 或 24k+000)"
                    value={end}
                    onChange={e => setEnd(e.target.value)}
                    className="flex-1 min-w-[140px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </>
              )}
              <input
                id="input-exempt-label"
                type="text"
                placeholder="備註 (例: 橋梁伸縮縫)"
                value={label}
                onChange={e => setLabel(e.target.value)}
                className="flex-1 min-w-[120px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                id="btn-exempt-add"
                type="button"
                onClick={add}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />新增
              </button>
            </div>
            {err && <p className="text-xs text-red-500 font-medium">{err}</p>}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold text-slate-600">
              免測規則清單 ({zones.length})
            </span>
            {zones.length > 0 && (
              <button
                id="btn-exempt-clear-all"
                type="button"
                onClick={clearAll}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium"
                title="清空所有免測規則"
              >
                <Trash2 className="w-3 h-3" />
                清空全部
              </button>
            )}
          </div>

          {zones.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">尚未設定免測路段</p>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {zones.map(z => (
                <div key={z.id} className="flex items-center justify-between bg-amber-50/80 border border-amber-200/80 rounded-lg px-3 py-2 text-xs hover:bg-amber-50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                    <span className="shrink-0 px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-semibold text-[11px]">
                      {z.type === "point" ? "單點" : "範圍"}
                    </span>
                    <span className="font-bold text-slate-800 shrink-0">{z.route}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                      z.direction ? "bg-blue-100 text-blue-700" : "bg-slate-200/70 text-slate-700"
                    }`}>
                      {z.direction || "全方向"}
                    </span>
                    <span className="text-blue-700 font-mono font-semibold tracking-wide">
                      {z.type === "point" ? formatMileage(z.mileage) : `${formatMileage(z.start)} ～ ${formatMileage(z.end)}`}
                    </span>
                    {z.label && (
                      <span className="text-slate-500 bg-white/80 px-2 py-0.5 rounded border border-amber-200 text-[11px] truncate max-w-[200px]" title={z.label}>
                        {z.label}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(z.id)}
                    className="shrink-0 ml-2 text-slate-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded hover:bg-white/50"
                    title="刪除此規則"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
