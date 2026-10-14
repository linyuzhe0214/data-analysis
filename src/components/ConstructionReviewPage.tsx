import React, { useState, useMemo, useRef } from 'react';
import {
  Upload, Trash2, HardHat, Activity, AlertTriangle, CheckCircle,
  Loader2, GitCompare, Compass, Layers, Map,
} from 'lucide-react';
import { PavementData } from '../types';
import { MileageTrendChart } from './MileageTrendChart';
import { ExemptZone } from './ExemptZoneManager';
import { MappingRule, parseWithMapping } from '../lib/excelParser';
import { ImportWizard } from './ImportWizard';

// ── re-use helpers ──────────────────────────────────────────────────────────
const normalizeLaneLocal = (lane: string | undefined): string => {
  if (!lane) return '外側車道';
  return String(lane)
    .replace('第1車道', '第一車道')
    .replace('第2車道', '第二車道')
    .replace('第3車道', '第三車道')
    .replace('第4車道', '第四車道')
    .replace('第5車道', '第五車道');
};

const normalizeDateStr = (raw: any): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) return s.split('T')[0];
  if (/^20\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const parts = s.replace(/[\/\.]/g, '-').split('-');
  if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  return s;
};

const parseMileageToNumber = (raw: any): number => {
  if (typeof raw === 'number') return raw > 1000 ? raw / 1000 : raw;
  if (!raw) return 0;
  const str = String(raw).trim();
  const num = Number(str);
  if (!isNaN(num)) return num > 1000 ? num / 1000 : num;
  const match = str.match(/(\d+)[kK\+]?\+?(\d+)/);
  if (match) return parseInt(match[1], 10) + parseInt(match[2], 10) / 1000;
  return 0;
};
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  dbData: PavementData[];
  exemptZones: ExemptZone[];
  MERGED_LANE_KEY: string;
}

type WizardState = { files: File[]; type: 'iri' | 'sn' };

interface FileRecord {
  id: number;
  fileName: string;
  type: 'iri' | 'sn';
  count: number;
}

let _id = 0;

const SELECT_STYLE: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 0.5rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '1.5em 1.5em',
};

export const ConstructionReviewPage: React.FC<Props> = ({ dbData, exemptZones, MERGED_LANE_KEY }) => {
  // ── 施工資料（sessionStorage 持久化：切分頁不清除，關閉瀏覽器才清）
  const [constData, setConstData] = useState<PavementData[]>(() => {
    try {
      const s = sessionStorage.getItem('_const_data');
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [fileRecords, setFileRecords] = useState<FileRecord[]>(() => {
    try {
      const s = sessionStorage.getItem('_const_records');
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [parsing, setParsing] = useState(false);

  // 同步寫入 sessionStorage
  React.useEffect(() => {
    try { sessionStorage.setItem('_const_data', JSON.stringify(constData)); } catch {}
  }, [constData]);
  React.useEffect(() => {
    try { sessionStorage.setItem('_const_records', JSON.stringify(fileRecords)); } catch {}
  }, [fileRecords]);

  // ── 篩選
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedDirection, setSelectedDirection] = useState('雙向');
  const [selectedLane, setSelectedLane] = useState('全車道');
  const [selectedIriDate, setSelectedIriDate] = useState('');
  const [selectedSnDate, setSelectedSnDate] = useState('');

  // ── 對比模式（顯示資料庫施工前最近一筆）
  const [compareMode, setCompareMode] = useState(false);

  const iriFileRef = useRef<HTMLInputElement>(null);
  const snFileRef = useRef<HTMLInputElement>(null);

  // ── 派生選項
  const routes = useMemo(() =>
    Array.from(new Set(constData.map(d => d.route))).sort()
  , [constData]);

  const availableDirections = useMemo(() => {
    const dirs = Array.from(new Set(
      constData.filter(d => !selectedRoute || d.route === selectedRoute).map(d => d.direction)
    )).filter(Boolean).sort() as string[];
    return ['雙向', ...dirs];
  }, [constData, selectedRoute]);

  const availableLanes = useMemo(() => {
    const lanes = Array.from(new Set(
      constData
        .filter(d => (!selectedRoute || d.route === selectedRoute) &&
          (selectedDirection === '雙向' || d.direction === selectedDirection))
        .map(d => d.lane)
    )).filter(Boolean) as string[];
    return ['全車道', ...lanes];
  }, [constData, selectedRoute, selectedDirection]);

  const availableIriDates = useMemo(() =>
    Array.from(new Set(
      constData.filter(d => d.iri > 0 && (!selectedRoute || d.route === selectedRoute)).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a))
  , [constData, selectedRoute]);

  const availableSnDates = useMemo(() =>
    Array.from(new Set(
      constData.filter(d => d.sn > 0 && (!selectedRoute || d.route === selectedRoute)).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a))
  , [constData, selectedRoute]);

  // ── 自動初始化選項
  React.useEffect(() => {
    if (routes.length > 0 && !routes.includes(selectedRoute)) setSelectedRoute(routes[0]);
  }, [routes]);
  React.useEffect(() => {
    if (availableIriDates.length > 0 && !availableIriDates.includes(selectedIriDate)) setSelectedIriDate(availableIriDates[0]);
  }, [availableIriDates]);
  React.useEffect(() => {
    if (availableSnDates.length > 0 && !availableSnDates.includes(selectedSnDate)) setSelectedSnDate(availableSnDates[0]);
  }, [availableSnDates]);
  React.useEffect(() => {
    if (!availableDirections.includes(selectedDirection)) setSelectedDirection('雙向');
  }, [availableDirections]);
  React.useEffect(() => {
    if (!availableLanes.includes(selectedLane)) setSelectedLane('全車道');
  }, [availableLanes]);

  // ── 統計
  const stats = useMemo(() => {
    if (constData.length === 0 || !selectedRoute) return null;

    const laneFilter = (lane: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return lane === '第二車道' || lane === '第三車道';
      return lane === selectedLane;
    };
    const baseFilter = (d: PavementData) =>
      d.route === selectedRoute &&
      (selectedDirection === '雙向' || d.direction === selectedDirection);

    const iriData = selectedIriDate
      ? constData.filter(d => baseFilter(d) && d.iri > 0 && d.date === selectedIriDate && laneFilter(d.lane))
      : [];
    const snData = selectedSnDate
      ? constData.filter(d => baseFilter(d) && d.sn > 0 && d.date === selectedSnDate && laneFilter(d.lane))
      : [];

    const n = iriData.length;
    const avgIri = n > 0 ? iriData.reduce((a, d) => a + d.iri, 0) / n : 0;
    const avgSn = snData.length > 0 ? snData.reduce((a, d) => a + d.sn, 0) / snData.length : 0;
    const iriB1 = iriData.filter(d => d.iri >= 1.75 && d.iri < 2.0).length;
    const iriB2 = iriData.filter(d => d.iri >= 2.0 && d.iri < 2.5).length;
    const iriB3 = iriData.filter(d => d.iri >= 2.5).length;
    const pct = (c: number) => (n > 0 ? (c / n * 100).toFixed(1) : '0.0');
    const countSn35 = snData.filter(d => d.sn > 0 && d.sn < 35).length;

    // 施工前（資料庫）對比
    let dbAvgIri = 0;
    let dbIriDate = '';
    if (compareMode && selectedIriDate) {
      const dbIriAll = dbData.filter(d =>
        d.route === selectedRoute &&
        (selectedDirection === '雙向' || d.direction === selectedDirection) &&
        d.iri > 0
      );
      const dbDates = Array.from(new Set(dbIriAll.map(d => d.date))).sort();
      const beforeDates = dbDates.filter(d => d < selectedIriDate);
      dbIriDate = beforeDates.length > 0 ? beforeDates[beforeDates.length - 1] : dbDates[0] || '';
      if (dbIriDate) {
        const dbIriData = dbIriAll.filter(d => d.date === dbIriDate && laneFilter(d.lane));
        dbAvgIri = dbIriData.length > 0 ? dbIriData.reduce((a, d) => a + d.iri, 0) / dbIriData.length : 0;
      }
    }

    return {
      avgIri: avgIri.toFixed(2), avgSn: avgSn.toFixed(1),
      iriCount: n, snCount: snData.length,
      iriBands: [
        { label: '1.75 ≤ IRI < 2.0', count: iriB1, pct: pct(iriB1), color: 'text-yellow-600' },
        { label: '2.0 ≤ IRI < 2.5',  count: iriB2, pct: pct(iriB2), color: 'text-orange-600' },
        { label: 'IRI ≥ 2.5',        count: iriB3, pct: pct(iriB3), color: 'text-red-600'    },
      ],
      countSn35,
      dbAvgIri: dbAvgIri > 0 ? dbAvgIri.toFixed(2) : null,
      dbIriDate,
      improvement: dbAvgIri > 0 && avgIri > 0 ? (dbAvgIri - avgIri).toFixed(2) : null,
    };
  }, [constData, selectedRoute, selectedDirection, selectedLane, selectedIriDate, selectedSnDate, compareMode, dbData, MERGED_LANE_KEY]);

  // ── 施工里程範圍（供對比圖過濾 dbData 用）
  const constMileageRange = useMemo(() => {
    if (!selectedRoute || constData.length === 0) return null;
    const ms = constData
      .filter(d => d.route === selectedRoute &&
        (selectedDirection === '雙向' || d.direction === selectedDirection))
      .map(d => d.mileage);
    if (ms.length === 0) return null;
    return { min: Math.min(...ms), max: Math.max(...ms) };
  }, [constData, selectedRoute, selectedDirection]);

  // 對比用 dbData：只保留施工里程範圍內（±0.01km tolerance）
  const filteredDbData = useMemo(() => {
    if (!compareMode || !constMileageRange) return dbData;
    const { min, max } = constMileageRange;
    return dbData.filter(d => d.mileage >= min - 0.01 && d.mileage <= max + 0.01);
  }, [dbData, compareMode, constMileageRange]);

  // ── 上傳
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'iri' | 'sn') => {
    const files = e.target.files;
    if (files && files.length > 0) setWizardState({ files: Array.from(files), type });
    e.target.value = '';
  };

  const handleWizardConfirm = async (rule: MappingRule) => {
    if (!wizardState) return;
    const { files, type } = wizardState;
    setWizardState(null);
    setParsing(true);
    try {
      const parsed = await parseWithMapping(files, rule, type);
      if (parsed.length === 0) return;
      const mapped: PavementData[] = parsed.map(p => ({
        date: normalizeDateStr(p.date),
        route: p.route || '未知路線',
        direction: p.direction || '未知方向',
        lane: normalizeLaneLocal(p.lane),
        mileage: parseMileageToNumber(p.mileage),
        iri: p.avgIri ? Number(p.avgIri) : 0,
        sn: p.sn ? Number(p.sn) : 0,
        prqi: p.avgPrqi ? Number(p.avgPrqi) : 0,
      }));
      setConstData(prev => [...prev, ...mapped]);
      setFileRecords(prev => [...prev, { id: ++_id, fileName: files.map(f => f.name).join(', '), type, count: parsed.length }]);
    } finally {
      setParsing(false);
    }
  };

  const clearAll = () => { setConstData([]); setFileRecords([]); setSelectedRoute(''); };

  // ── 對比資料庫日期
  const dbCompareDates = useMemo(() => {
    if (!compareMode || !selectedRoute) return { iriDate: '', snDate: '' };
    const getLatestBefore = (dates: string[], before: string) => {
      const sorted = [...dates].sort();
      const before_ = sorted.filter(d => !before || d < before);
      return before_.length > 0 ? before_[before_.length - 1] : sorted[0] || '';
    };
    const dbIriDates = Array.from(new Set(dbData.filter(d => d.route === selectedRoute && d.iri > 0).map(d => d.date)));
    const dbSnDates  = Array.from(new Set(dbData.filter(d => d.route === selectedRoute && d.sn > 0).map(d => d.date)));
    return {
      iriDate: getLatestBefore(dbIriDates, selectedIriDate),
      snDate:  getLatestBefore(dbSnDates,  selectedSnDate),
    };
  }, [compareMode, selectedRoute, selectedIriDate, selectedSnDate, dbData]);

  const chartDirs = useMemo(() =>
    (selectedDirection === '雙向' || !selectedDirection)
      ? availableDirections.filter(d => d !== '雙向')
      : [selectedDirection]
  , [selectedDirection, availableDirections]);

  // ══════════════════════════════════════════════════════════════════════════
  //  空狀態
  // ══════════════════════════════════════════════════════════════════════════
  if (constData.length === 0) {
    return (
      <div className="space-y-6">
        {wizardState && <ImportWizard files={wizardState.files} type={wizardState.type} onConfirm={handleWizardConfirm} onCancel={() => setWizardState(null)} />}
        <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" ref={iriFileRef} onChange={e => handleFileChange(e, 'iri')} />
        <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" ref={snFileRef}  onChange={e => handleFileChange(e, 'sn')} />

        <div className="flex flex-col items-center justify-center min-h-[420px] bg-white rounded-2xl border-2 border-dashed border-orange-200 text-center p-10 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center">
            <HardHat className="w-8 h-8 text-orange-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">施工品質檢視模式</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              上傳施工後的 IRI / SN 檢測數據，即時查看品質統計與趨勢圖。<br />
              可開啟「前後對比」疊加資料庫施工前最近一筆資料。<br />
              <span className="text-orange-500 font-semibold mt-1 block">⚠ 此模式資料不會存入資料庫，關閉或重整後自動清除。</span>
            </p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <button onClick={() => iriFileRef.current?.click()} disabled={parsing}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow transition-colors disabled:opacity-50">
              <Upload className="w-4 h-4" /> 上傳施工後 IRI
            </button>
            <button onClick={() => snFileRef.current?.click()} disabled={parsing}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold shadow transition-colors disabled:opacity-50">
              <Upload className="w-4 h-4" /> 上傳施工後 SN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  主畫面
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {wizardState && <ImportWizard files={wizardState.files} type={wizardState.type} onConfirm={handleWizardConfirm} onCancel={() => setWizardState(null)} />}
      <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" ref={iriFileRef} onChange={e => handleFileChange(e, 'iri')} />
      <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" ref={snFileRef}  onChange={e => handleFileChange(e, 'sn')} />

      {/* ── 工具列 */}
      <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <HardHat className="w-4 h-4 text-orange-600 shrink-0" />
        <span className="text-xs font-bold text-orange-700">
          施工品質暫存中 — 共 {constData.length} 筆資料，重整後自動清除
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {parsing && <span className="flex items-center gap-1 text-xs text-blue-600"><Loader2 className="w-3 h-3 animate-spin" />解析中...</span>}
          <button onClick={() => iriFileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors">
            <Upload className="w-3 h-3" /> 追加 IRI
          </button>
          <button onClick={() => snFileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors">
            <Upload className="w-3 h-3" /> 追加 SN
          </button>
          <button onClick={() => setCompareMode(m => !m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
              compareMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'
            }`}>
            <GitCompare className="w-3 h-3" />
            {compareMode ? '對比 ON' : '前後對比'}
          </button>
          <button onClick={clearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-xs font-bold transition-colors">
            <Trash2 className="w-3 h-3" /> 清空
          </button>
        </div>
      </div>

      {/* 已上傳檔案 */}
      {fileRecords.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {fileRecords.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${r.type === 'iri' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                {r.type.toUpperCase()}
              </span>
              <span className="flex-1 text-sm text-slate-600 truncate">{r.fileName}</span>
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {r.count} 筆（暫存）
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 篩選 */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* 路線 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1 uppercase tracking-wider">
              <Map className="w-3.5 h-3.5" /> 路線
            </label>
            <select value={selectedRoute} onChange={e => setSelectedRoute(e.target.value)}
              className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2 px-3 text-sm font-medium text-slate-700 outline-none appearance-none cursor-pointer"
              style={SELECT_STYLE}>
              {routes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {/* 方向 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1 uppercase tracking-wider">
              <Compass className="w-3.5 h-3.5" /> 方向
            </label>
            <select value={selectedDirection} onChange={e => setSelectedDirection(e.target.value)}
              className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2 px-3 text-sm font-medium text-slate-700 outline-none appearance-none cursor-pointer"
              style={SELECT_STYLE}>
              {availableDirections.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {/* 車道 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1 uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5" /> 車道
            </label>
            <select value={selectedLane} onChange={e => setSelectedLane(e.target.value)}
              className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2 px-3 text-sm font-medium text-slate-700 outline-none appearance-none cursor-pointer"
              style={SELECT_STYLE}>
              {availableLanes.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {/* IRI 日期 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-blue-500 flex items-center gap-1 uppercase tracking-wider">
              <Activity className="w-3.5 h-3.5" /> IRI 施工後日期
            </label>
            <select value={selectedIriDate} onChange={e => setSelectedIriDate(e.target.value)}
              className="w-full border border-blue-200 bg-blue-50 rounded-lg py-2 px-3 text-sm font-bold text-blue-700 outline-none appearance-none cursor-pointer"
              style={SELECT_STYLE}>
              {availableIriDates.length > 0
                ? availableIriDates.map(d => <option key={d} value={d}>{d}</option>)
                : <option value="">無資料</option>}
            </select>
          </div>
          {/* SN 日期 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-purple-500 flex items-center gap-1 uppercase tracking-wider">
              <Activity className="w-3.5 h-3.5" /> SN 施工後日期
            </label>
            <select value={selectedSnDate} onChange={e => setSelectedSnDate(e.target.value)}
              className="w-full border border-purple-200 bg-purple-50 rounded-lg py-2 px-3 text-sm font-bold text-purple-700 outline-none appearance-none cursor-pointer"
              style={SELECT_STYLE}>
              {availableSnDates.length > 0
                ? availableSnDates.map(d => <option key={d} value={d}>{d}</option>)
                : <option value="">無資料</option>}
            </select>
          </div>
        </div>
      </div>

      {/* ── 統計卡片 */}
      {stats && (
        <div className="space-y-3">
          {/* 對比 banner */}
          {compareMode && stats.dbAvgIri && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex-wrap">
              <GitCompare className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="text-sm text-slate-600">
                施工前 <span className="font-semibold text-slate-700">({stats.dbIriDate})</span> 平均 IRI：
                <strong className="text-indigo-700 text-base ml-1">{stats.dbAvgIri}</strong>
              </span>
              <span className="text-slate-400">→</span>
              <span className="text-sm text-slate-600">
                施工後 <span className="font-semibold text-slate-700">({selectedIriDate})</span> 平均 IRI：
                <strong className="text-green-700 text-base ml-1">{stats.avgIri}</strong>
              </span>
              {stats.improvement !== null && (
                Number(stats.improvement) > 0
                  ? <span className="px-2.5 py-0.5 bg-green-100 text-green-700 font-bold rounded-full text-sm">↓ 改善 {stats.improvement}</span>
                  : <span className="px-2.5 py-0.5 bg-red-100 text-red-700 font-bold rounded-full text-sm">↑ 上升 {Math.abs(Number(stats.improvement))}</span>
              )}
            </div>
          )}

          <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {/* 平均 IRI */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-blue-600">
                  <Activity className="w-4 h-4" />
                  <span className="text-xs font-medium">施工後平均 IRI</span>
                </div>
                <p className="text-2xl font-bold text-slate-800">{stats.avgIri}</p>
                {stats.iriCount > 0 && <span className="text-[10px] text-slate-400">{stats.iriCount} 測點</span>}
              </div>
              {/* 級距 */}
              {stats.iriBands.map(band => (
                <div key={band.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1">
                  <div className={`flex items-center gap-1.5 ${band.color}`}>
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-medium whitespace-nowrap">{band.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-800">
                    {band.count} 處
                    <span className="text-sm font-medium text-slate-400 ml-1">/ {band.pct}%</span>
                  </p>
                </div>
              ))}
              {/* 平均 SN */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-purple-600">
                  <Activity className="w-4 h-4" />
                  <span className="text-xs font-medium">施工後平均 SN</span>
                </div>
                <p className="text-2xl font-bold text-slate-800">{stats.avgSn}</p>
                {stats.snCount > 0 && <span className="text-[10px] text-slate-400">{stats.snCount} 測點</span>}
              </div>
              {/* SN < 35 */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-medium">SN &lt; 35</span>
                </div>
                <p className="text-2xl font-bold text-slate-800">{stats.countSn35} 處</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 趨勢圖 */}
      <div className="space-y-6">
        {chartDirs.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
            此條件下無資料
          </div>
        ) : chartDirs.map(dir => (
          <div key={dir} className="space-y-5">
            {/* 施工後（橘色框） */}
            <div className="rounded-2xl overflow-hidden ring-2 ring-orange-300">
              <div className="bg-orange-50 border-b border-orange-200 px-4 py-2.5 flex items-center gap-2">
                <HardHat className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-bold text-orange-700">
                  施工後（{selectedRoute} {dir}）— 暫存，未存入資料庫
                </span>
              </div>
              <div className="bg-white p-4 space-y-4">
                {selectedLane !== MERGED_LANE_KEY && (
                  <MileageTrendChart data={constData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="iri" exemptZones={exemptZones} />
                )}
                {selectedLane !== MERGED_LANE_KEY && (
                  <MileageTrendChart data={constData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="prqi" exemptZones={[]} />
                )}
                <MileageTrendChart data={constData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="sn" exemptZones={[]} />
              </div>
            </div>

            {/* 施工前對比（藍色框） */}
            {compareMode && dbCompareDates.iriDate && (
              <div className="rounded-2xl overflow-hidden ring-2 ring-indigo-300">
                <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-2.5 flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-700">
                    施工前（資料庫 {dbCompareDates.iriDate} — {selectedRoute} {dir}）
                  </span>
                </div>
                <div className="bg-white p-4 space-y-4">
                  {selectedLane !== MERGED_LANE_KEY && (
                    <MileageTrendChart data={filteredDbData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="iri" exemptZones={exemptZones} />
                  )}
                  {selectedLane !== MERGED_LANE_KEY && (
                    <MileageTrendChart data={filteredDbData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="prqi" exemptZones={exemptZones} />
                  )}
                  {dbCompareDates.snDate && (
                    <MileageTrendChart data={filteredDbData} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="sn" exemptZones={exemptZones} />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
