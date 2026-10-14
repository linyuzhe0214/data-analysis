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
        const m = parseFloat(p);
        if (isNaN(m)) { setErr(`里程「${p}」非有效數值`); return; }
        newItems.push({ id: crypto.randomUUID(), route, direction, type: "point", mileage: m, label });
      }
      onChange([...zones, ...newItems]);
      setMileage("");
    } else {
      const s = parseFloat(start);
      const e = parseFloat(end);
      if (isNaN(s) || isNaN(e)) { setErr("請輸入有效起迄里程"); return; }
      if (s === e) { setErr("起點與終點里程不可相同（如為單一位置請選「單點」）"); return; }
      const [minK, maxK] = s < e ? [s, e] : [e, s];
      onChange([...zones, { id: crypto.randomUUID(), route, direction, type: "range", start: minK, end: maxK, label }]);
      setStart(""); setEnd("");
    }
    setLabel("");
  };

  const remove = (id: string) => onChange(zones.filter(z => z.id !== id));
  const clearAll = () => {
    if (window.confirm("確定要清空所有免測路段規則嗎？")) {
      onChange([]);
    }
  };

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
                  placeholder="里程 km (例: 160.2 或多點 160.2, 161.5)"
                  value={mileage}
                  onChange={e => setMileage(e.target.value)}
                  className="flex-1 min-w-[220px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                />
              ) : (
                <>
                  <input
                    id="input-exempt-start-mileage"
                    type="number"
                    step="any"
                    placeholder="起點里程 (km)"
                    value={start}
                    onChange={e => setStart(e.target.value)}
                    className="flex-1 min-w-[140px] border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-slate-400 text-xs">～</span>
                  <input
                    id="input-exempt-end-mileage"
                    type="number"
                    step="any"
                    placeholder="終點里程 (km)"
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
                className="text-xs text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
              >
                清空全部
              </button>
            )}
          </div>

          {zones.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">尚未設定免測路段</p>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {zones.map(z => (
                <div key={z.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                    <span className="shrink-0 px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-semibold text-[11px]">{z.type === "point" ? "單點" : "範圍"}</span>
                    <span className="font-semibold text-slate-800 shrink-0">{z.route}</span>
                    {z.direction && <span className="text-slate-500 shrink-0">{z.direction}</span>}
                    <span className="text-blue-700 font-mono font-medium">
                      {z.type === "point" ? `K${z.mileage?.toFixed(3)}` : `K${z.start?.toFixed(3)} ～ K${z.end?.toFixed(3)}`}
                    </span>
                    {z.label && <span className="text-slate-500 bg-white/70 px-1.5 py-0.5 rounded border border-amber-100 truncate">{z.label}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(z.id)}
                    className="shrink-0 ml-2 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
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
