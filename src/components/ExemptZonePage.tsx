import React, { useState, useMemo, useRef } from "react";
import { 
  ShieldOff, PlusCircle, Trash2, Download, Upload, Cloud, RefreshCw, 
  Search, Filter, CheckCircle, AlertTriangle, FileSpreadsheet, ArrowUpDown, ChevronLeft, ChevronRight
} from "lucide-react";
import { ExemptZone, formatMileage, parseMileageInput } from "./ExemptZoneManager";
import { uploadExemptZones, fetchExemptZones, GAS_URL } from "../lib/gasService";

interface Props {
  zones: ExemptZone[];
  routes: string[];
  directions: string[];
  onChange: (zones: ExemptZone[]) => void;
}

export function ExemptZonePage({ zones, routes, directions, onChange }: Props) {
  // 篩選與搜尋
  const [filterRoute, setFilterRoute] = useState<string>("全部");
  const [filterDir, setFilterDir] = useState<string>("全部");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  // 新增表單 state
  const [type, setType] = useState<"point" | "range">("range");
  const [route, setRoute] = useState(routes[0] || "國道1號");
  const [direction, setDirection] = useState("");
  const [mileage, setMileage] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");

  // 雲端同步狀態
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // 表格多選與分頁
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 篩選後的清單
  const filteredZones = useMemo(() => {
    return zones.filter(z => {
      if (filterRoute !== "全部" && z.route !== filterRoute) return false;
      if (filterDir !== "全部") {
        if (filterDir === "全方向" && z.direction) return false;
        if (filterDir !== "全方向" && z.direction !== filterDir) return false;
      }
      if (searchKeyword.trim()) {
        const kw = searchKeyword.trim().toLowerCase();
        const mStr = z.type === "point" ? formatMileage(z.mileage) : `${formatMileage(z.start)} ${formatMileage(z.end)}`;
        const matchLabel = (z.label || "").toLowerCase().includes(kw);
        const matchRoute = z.route.toLowerCase().includes(kw);
        const matchMileage = mStr.toLowerCase().includes(kw);
        if (!matchLabel && !matchRoute && !matchMileage) return false;
      }
      return true;
    });
  }, [zones, filterRoute, filterDir, searchKeyword]);

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(filteredZones.length / pageSize));
  const pageZones = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredZones.slice(startIdx, startIdx + pageSize);
  }, [filteredZones, currentPage, pageSize]);

  // 新增單筆或多筆
  const handleAdd = () => {
    setErr("");
    if (!route) { setErr("請選擇路線"); return; }
    if (type === "point") {
      const parts = mileage.split(/[\s,，、\n]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) { setErr("請輸入有效里程 (支援如 23100 或 23k+100)"); return; }
      const newItems: ExemptZone[] = [];
      for (const p of parts) {
        const m = parseMileageInput(p);
        if (isNaN(m)) { setErr(`里程「${p}」無法識別`); return; }
        newItems.push({ id: crypto.randomUUID(), route, direction, type: "point", mileage: m, label });
      }
      onChange([...newItems, ...zones]);
      setMileage("");
    } else {
      const s = parseMileageInput(start);
      const e = parseMileageInput(end);
      if (isNaN(s) || isNaN(e)) { setErr("請輸入有效起訖里程 (支援如 23000、23k+000 或 23.0)"); return; }
      if (s === e) { setErr("起點與終點里程不可相同"); return; }
      const [minK, maxK] = s < e ? [s, e] : [e, s];
      onChange([{ id: crypto.randomUUID(), route, direction, type: "range", start: minK, end: maxK, label }, ...zones]);
      setStart(""); setEnd("");
    }
    setLabel("");
  };

  // 單筆刪除
  const handleDeleteOne = (id: string) => {
    onChange(zones.filter(z => z.id !== id));
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  // 批次刪除已選取
  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    onChange(zones.filter(z => !selectedIds.includes(z.id)));
    setSelectedIds([]);
  };

  // 全選 / 取消全選本頁
  const handleToggleSelectAllPage = () => {
    const pageIds = pageZones.map(z => z.id);
    const allSelected = pageIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  // 儲存至雲端資料庫
  const handleSaveToCloud = async () => {
    if (!GAS_URL) {
      setSyncMsg({ text: "尚未設定雲端資料庫 (GAS_URL)", ok: false });
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await uploadExemptZones(zones);
      if (res.success) {
        setSyncMsg({ text: `成功將 ${zones.length} 條規則儲存至雲端資料庫！`, ok: true });
      } else {
        setSyncMsg({ text: res.error || "儲存失敗", ok: false });
      }
    } catch (e: any) {
      setSyncMsg({ text: `儲存異常: ${e.message}`, ok: false });
    } finally {
      setSyncing(false);
    }
  };

  // 從雲端重新載入
  const handleFetchFromCloud = async () => {
    if (!GAS_URL) {
      setSyncMsg({ text: "尚未設定雲端資料庫 (GAS_URL)", ok: false });
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const cloudZones = await fetchExemptZones(true);
      if (cloudZones && cloudZones.length > 0) {
        onChange(cloudZones);
        setSyncMsg({ text: `已成功從雲端載入 ${cloudZones.length} 條規則！`, ok: true });
      } else {
        setSyncMsg({ text: "雲端資料庫中目前尚無免測資料", ok: false });
      }
    } catch (e: any) {
      setSyncMsg({ text: `載入異常: ${e.message}`, ok: false });
    } finally {
      setSyncing(false);
    }
  };

  // 匯出 CSV
  const handleExportCSV = () => {
    if (zones.length === 0) return;
    const headers = ["路線", "方向", "類型", "起點公里", "終點公里", "單點公里", "起訖工程里程", "備註說明"];
    const rows = zones.map(z => [
      z.route,
      z.direction || "全方向",
      z.type === "point" ? "單點" : "範圍",
      z.type === "range" ? z.start : "",
      z.type === "range" ? z.end : "",
      z.type === "point" ? z.mileage : "",
      z.type === "point" ? formatMileage(z.mileage) : `${formatMileage(z.start)}～${formatMileage(z.end)}`,
      `"${(z.label || "").replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `免測路段清單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 匯入 CSV / Excel
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const parsed: ExemptZone[] = [];
      // 依序解析各行
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length >= 4) {
          const r = cols[0];
          const dir = cols[1] === "全方向" ? "" : cols[1];
          const tStr = cols[2];
          const s = parseMileageInput(cols[3]);
          const eVal = parseMileageInput(cols[4]);
          const m = parseMileageInput(cols[5]);
          const lbl = cols[7] || cols[6] || "";

          if (tStr === "單點" || !isNaN(m)) {
            parsed.push({
              id: crypto.randomUUID(),
              route: r,
              direction: dir,
              type: "point",
              mileage: !isNaN(m) ? m : s,
              label: lbl
            });
          } else if (!isNaN(s) && !isNaN(eVal)) {
            const [minK, maxK] = s < eVal ? [s, eVal] : [eVal, s];
            parsed.push({
              id: crypto.randomUUID(),
              route: r,
              direction: dir,
              type: "range",
              start: minK,
              end: maxK,
              label: lbl
            });
          }
        }
      }
      if (parsed.length > 0) {
        onChange([...parsed, ...zones]);
        setSyncMsg({ text: `成功匯入 ${parsed.length} 條免測規則！`, ok: true });
      } else {
        setSyncMsg({ text: "檔案內未偵測到相容格式資料", ok: false });
      }
    } catch (err: any) {
      setSyncMsg({ text: `匯入失敗: ${err.message}`, ok: false });
    }
    e.target.value = "";
  };

  const dirsForRoute = ["（全方向）", ...directions.filter(d => d !== "雙向")];

  return (
    <div className="space-y-6">
      <input 
        type="file" 
        accept=".csv,.txt" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleImportFile}
      />

      {/* 頂部數據看板 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <span className="text-xs text-slate-500 font-medium">免測規則總數</span>
          <p className="text-2xl font-bold text-slate-800 mt-1">{zones.length} <span className="text-xs font-normal text-slate-400">處/區間</span></p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <span className="text-xs text-blue-600 font-medium">單點伸縮縫規則</span>
          <p className="text-2xl font-bold text-blue-700 mt-1">{zones.filter(z => z.type === "point").length} <span className="text-xs font-normal text-slate-400">處</span></p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <span className="text-xs text-amber-600 font-medium">範圍免測區間</span>
          <p className="text-2xl font-bold text-amber-700 mt-1">{zones.filter(z => z.type === "range").length} <span className="text-xs font-normal text-slate-400">段</span></p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <span className="text-xs text-emerald-600 font-medium">涵蓋國道路線</span>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{new Set(zones.map(z => z.route)).size} <span className="text-xs font-normal text-slate-400">條國道</span></p>
        </div>
      </div>

      {/* 雲端同步反饋提示 */}
      {syncMsg && (
        <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-medium ${
          syncMsg.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {syncMsg.ok ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
          <span>{syncMsg.text}</span>
        </div>
      )}

      {/* 新增路段面板 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
            <PlusCircle className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">新增免測路段 / 伸縮縫</h3>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            {/* 類型按鈕 */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
              <button
                type="button"
                onClick={() => setType("range")}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${type === "range" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              >範圍區間</button>
              <button
                type="button"
                onClick={() => setType("point")}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${type === "point" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              >單點 (支援貼上多筆)</button>
            </div>

            {/* 路線選單 */}
            <select
              value={route}
              onChange={e => setRoute(e.target.value)}
              className="border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none cursor-pointer"
            >
              {routes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            {/* 方向選單 */}
            <select
              value={direction || "（全方向）"}
              onChange={e => setDirection(e.target.value === "（全方向）" ? "" : e.target.value)}
              className="border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none cursor-pointer"
            >
              {dirsForRoute.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            {type === "point" ? (
              <input
                type="text"
                placeholder="里程 (支援 23100 或 23k+100，多點以逗點/空格分隔)"
                value={mileage}
                onChange={e => setMileage(e.target.value)}
                className="flex-1 min-w-[260px] border border-slate-200 bg-slate-50 focus:bg-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-300"
              />
            ) : (
              <>
                <input
                  type="text"
                  placeholder="起點 (例: 23100 或 23k+100)"
                  value={start}
                  onChange={e => setStart(e.target.value)}
                  className="flex-1 min-w-[160px] border border-slate-200 bg-slate-50 focus:bg-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                />
                <span className="text-slate-400 text-xs font-bold">～</span>
                <input
                  type="text"
                  placeholder="終點 (例: 24000 或 24k+000)"
                  value={end}
                  onChange={e => setEnd(e.target.value)}
                  className="flex-1 min-w-[160px] border border-slate-200 bg-slate-50 focus:bg-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-300"
                />
              </>
            )}
            <input
              type="text"
              placeholder="備註說明 (例: 大安溪橋伸縮縫)"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="flex-1 min-w-[160px] border border-slate-200 bg-slate-50 focus:bg-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />新增規則
            </button>
          </div>
          {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}
        </div>
      </div>

      {/* 資料清單與工具列 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 工具列 Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* 路線篩選 */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500 font-medium">路線:</span>
              <select
                value={filterRoute}
                onChange={e => { setFilterRoute(e.target.value); setCurrentPage(1); }}
                className="border border-slate-200 bg-white rounded-lg px-2 py-1 text-xs text-slate-700 outline-none"
              >
                <option value="全部">全部路線</option>
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* 方向篩選 */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500 font-medium">方向:</span>
              <select
                value={filterDir}
                onChange={e => { setFilterDir(e.target.value); setCurrentPage(1); }}
                className="border border-slate-200 bg-white rounded-lg px-2 py-1 text-xs text-slate-700 outline-none"
              >
                <option value="全部">全部方向</option>
                <option value="全方向">全方向</option>
                <option value="南下">南下</option>
                <option value="北上">北上</option>
                <option value="東向">東向</option>
                <option value="西向">西向</option>
              </select>
            </div>

            {/* 搜尋關鍵字 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜尋里程或備註..."
                value={searchKeyword}
                onChange={e => { setSearchKeyword(e.target.value); setCurrentPage(1); }}
                className="pl-8 pr-3 py-1 border border-slate-200 bg-white rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-400 w-36 sm:w-48"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                刪除所選 ({selectedIds.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              title="匯入 CSV 免測清單"
            >
              <Upload className="w-3.5 h-3.5 text-blue-600" />
              匯入
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              title="匯出為 CSV 檔備份"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              匯出
            </button>

            {GAS_URL && (
              <>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleSaveToCloud}
                  className="flex items-center gap-1 px-3 py-1 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  title="將目前所有規則儲存寫入 Google Sheets 雲端資料庫"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  {syncing ? "儲存中..." : "存至雲端"}
                </button>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleFetchFromCloud}
                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50"
                  title="由雲端資料庫同步"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                </button>
              </>
            )}

            {zones.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空全部
              </button>
            )}
          </div>
        </div>

        {/* 表格清單 */}
        {filteredZones.length === 0 ? (
          <div className="py-16 text-center text-slate-400 space-y-2">
            <ShieldOff className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-600">尚無符合條件的免測路段</p>
            <p className="text-xs text-slate-400">請由上方表單新增，或透過匯入功能快速建立清單</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                  <th className="py-3 px-4 w-10 text-center">
                    <input 
                      type="checkbox" 
                      checked={pageZones.length > 0 && pageZones.every(z => selectedIds.includes(z.id))}
                      onChange={handleToggleSelectAllPage}
                      className="rounded border-slate-300 text-blue-600 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-3 w-16">類型</th>
                  <th className="py-3 px-3">路線</th>
                  <th className="py-3 px-3">方向</th>
                  <th className="py-3 px-4">工程里程 (Xk+YYY)</th>
                  <th className="py-3 px-3">原始里程 (km)</th>
                  <th className="py-3 px-4">備註說明</th>
                  <th className="py-3 px-4 text-center w-16">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageZones.map((z, idx) => {
                  const isChecked = selectedIds.includes(z.id);
                  return (
                    <tr key={z.id} className={`hover:bg-blue-50/40 transition-colors ${isChecked ? "bg-blue-50/60" : ""}`}>
                      <td className="py-2.5 px-4 text-center">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={() => {
                            setSelectedIds(prev => isChecked ? prev.filter(i => i !== z.id) : [...prev, z.id]);
                          }}
                          className="rounded border-slate-300 text-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                          z.type === "point" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {z.type === "point" ? "單點" : "範圍"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-800">{z.route}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          z.direction ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"
                        }`}>
                          {z.direction || "全方向"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-700 tracking-wide text-[13px]">
                        {z.type === "point" ? formatMileage(z.mileage) : `${formatMileage(z.start)} ～ ${formatMileage(z.end)}`}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {z.type === "point" ? z.mileage?.toFixed(3) : `${z.start?.toFixed(3)} - ${z.end?.toFixed(3)}`}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {z.label ? (
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                            {z.label}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteOne(z.id)}
                          className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 分頁 Pagination Footer */}
        {filteredZones.length > 0 && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
            <div>
              顯示第 <strong>{(currentPage - 1) * pageSize + 1}</strong> 至 <strong>{Math.min(currentPage * pageSize, filteredZones.length)}</strong> 筆，共 <strong>{filteredZones.length}</strong> 筆規則
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span>每頁筆數:</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="border border-slate-200 bg-white rounded px-2 py-0.5 text-xs outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="p-1 border border-slate-200 bg-white rounded disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2">第 {currentPage} / {totalPages} 頁</span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="p-1 border border-slate-200 bg-white rounded disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
