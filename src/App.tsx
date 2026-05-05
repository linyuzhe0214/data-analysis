import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, Activity, AlertTriangle, CheckCircle, Map, TrendingUp, Loader2, Database, Filter, Calendar, Compass, Layers } from 'lucide-react';
import { PavementData } from './types';
import { MileageTrendChart } from './components/MileageTrendChart';
import { ColorMap } from './components/ColorMap';
import { ImportWizard } from './components/ImportWizard';
import { MappingRule, parseWithMapping } from './lib/excelParser';
import { uploadSNData, uploadIRIData, fetchSNData, fetchIRIData, GAS_URL } from './lib/gasService';

type UploadStatus = 'idle' | 'parsing' | 'uploading' | 'done' | 'error';

interface UploadResult {
  type: 'iri' | 'sn';
  fileName: string;
  parsed: number;
  inserted: number;
  status: UploadStatus;
  message?: string;
}

const LS_KEY = 'pavement_data_v1';

function loadFromLocalStorage(): PavementData[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    
    const parsed = JSON.parse(raw) as PavementData[];
    
    const normalizeDateStr = (rawVal: any): string => {
      if (!rawVal) return new Date().toISOString().split('T')[0];
      let s = String(rawVal).trim();
      if (s.includes('T') && s.endsWith('Z')) {
         const d = new Date(s);
         if (!isNaN(d.getTime())) {
             const y = d.getFullYear();
             const m = String(d.getMonth() + 1).padStart(2, '0');
             const day = String(d.getDate()).padStart(2, '0');
             s = `${y}-${m}-${day}`;
         } else {
             s = s.split('T')[0];
         }
      } else if (s.includes('T')) {
          s = s.split('T')[0];
      }
      if (/^20\d{6}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      s = s.replace(/[\/\.]/g, '-');
      const parts = s.split('-');
      if (parts.length === 3) {
          parts[1] = parts[1].padStart(2, '0');
          parts[2] = parts[2].padStart(2, '0');
          s = parts.join('-');
      }
      return s;
    };

    return parsed.map(d => ({
      ...d,
      date: normalizeDateStr(d.date)
    }));
  } catch {
    return [];
  }
}

export const normalizeLane = (lane: string | undefined): string => {
  if (!lane) return '外側車道';
  return String(lane)
    .replace('第1車道', '第一車道')
    .replace('第2車道', '第二車道')
    .replace('第3車道', '第三車道')
    .replace('第4車道', '第四車道')
    .replace('第5車道', '第五車道');
};

export default function App() {
  const [rawData, setRawData] = useState<PavementData[]>(loadFromLocalStorage);

  const setDataPersist = (updater: PavementData[] | ((prev: PavementData[]) => PavementData[])) => {
    setRawData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const data = useMemo(() => {
    return rawData.map(d => {
      let lane = normalizeLane(d.lane);
                 
      if (d.route.includes('4') && ['第二車道', '第三車道'].includes(lane)) {
        return { ...d, lane: '第2及第3車道' };
      }
      return { ...d, lane };
    });
  }, [rawData]);
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedDirection, setSelectedDirection] = useState<string>('');
  const [selectedLane, setSelectedLane] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedIriDate, setSelectedIriDate] = useState<string>('');
  const [selectedSnDate, setSelectedSnDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'trends' | 'iri-map'>('trends');
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [wizardState, setWizardState] = useState<{ files: File[], type: 'iri' | 'sn' } | null>(null);

  // 從雲端資料庫同步（可手動觸發）
  const syncFromDB = async () => {
    if (!GAS_URL) return;
    setIsSyncing(true);
    try {
      const [snRaw, iriRaw] = await Promise.all([
        fetchSNData().catch(() => [] as any[]),
        fetchIRIData().catch(() => [] as any[])
      ]);
      
      const normalizeDateStr = (raw: any): string => {
        if (!raw) return new Date().toISOString().split('T')[0];
        let s = String(raw).trim();
        if (s.includes('T') && s.endsWith('Z')) {
           const d = new Date(s);
           if (!isNaN(d.getTime())) {
               const y = d.getFullYear();
               const m = String(d.getMonth() + 1).padStart(2, '0');
               const day = String(d.getDate()).padStart(2, '0');
               s = `${y}-${m}-${day}`;
           } else {
               s = s.split('T')[0];
           }
        } else if (s.includes('T')) {
            s = s.split('T')[0];
        }
        if (/^20\d{6}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        s = s.replace(/[\/\.]/g, '-');
        const parts = s.split('-');
        if (parts.length === 3) {
            parts[1] = parts[1].padStart(2, '0');
            parts[2] = parts[2].padStart(2, '0');
            s = parts.join('-');
        }
        return s;
      };
      
      const parseMileageToNumber = (raw: any): number => {
        if (typeof raw === 'number') return raw > 1000 ? raw / 1000 : raw;
        const str = String(raw || '');
        const match = str.match(/(\d+)[kK\+]?\+?(\d+)/);
        if (match) return parseInt(match[1], 10) + parseInt(match[2], 10) / 1000;
        const num = parseFloat(str);
        return isNaN(num) ? 0 : (num > 1000 ? num / 1000 : num);
      };

      const newPavementData: PavementData[] = [];

      snRaw.forEach(p => {
        newPavementData.push({
          date: normalizeDateStr(p.date),
          route: p.route || '未知路線',
          direction: p.direction || '未知方向',
          lane: normalizeLane(p.lane),
          mileage: parseMileageToNumber(p.mileage),
          iri: 0,
          sn: p.sn ? Number(p.sn) : 0,
          prqi: 0
        });
      });

      iriRaw.forEach(p => {
        newPavementData.push({
          date: normalizeDateStr(p.date),
          route: p.route || '未知路線',
          direction: p.direction || '未知方向',
          lane: normalizeLane(p.lane),
          mileage: parseMileageToNumber(p.mileage),
          iri: p.avgIri ? Number(p.avgIri) : 0,
          sn: 0,
          prqi: p.avgPrqi ? Number(p.avgPrqi) : 0
        });
      });

      if (newPavementData.length > 0) {
        // 強制清除舊快取，用資料庫資料完全覆寫
        localStorage.removeItem(LS_KEY);
        setDataPersist(newPavementData);
      }
    } catch (e) {
      console.error('Failed to auto-sync from DB:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // 網頁載入時自動從雲端資料庫同步
  useEffect(() => {
    syncFromDB();
  }, []);

  const iriFileInputRef = useRef<HTMLInputElement>(null);
  const snFileInputRef = useRef<HTMLInputElement>(null);

  const routes = useMemo(() => {
    const dataRoutes = Array.from(new Set(data.map(d => d.route))) as string[];
    const predefined = ['國道1號', '國道3號', '國道4號'];
    const others = dataRoutes.filter(r => !predefined.includes(r)).sort();
    return [...predefined.filter(r => dataRoutes.includes(r)), ...others];
  }, [data]);

  const availableDirections = useMemo(() => {
    const dataDirs = Array.from(new Set(data.filter(d => d.route === selectedRoute).map(d => d.direction))).filter(Boolean).sort() as string[];
    const predefined = (selectedRoute === '國道4號') ? ['東向', '西向'] : ['南下', '北上'];
    const validPredefined = predefined.filter(d => dataDirs.includes(d));
    const others = dataDirs.filter(d => !predefined.includes(d));
    
    // 如果資料中有方向就回傳，都沒有的話才回傳預設的避免畫面出錯
    const result = [...validPredefined, ...others];
    return result.length > 0 ? result : predefined;
  }, [selectedRoute, data]);

  const availableLanes = useMemo(() => {
    const dataLanes = Array.from(new Set(data.filter(d => d.route === selectedRoute && d.direction === selectedDirection).map(d => d.lane))).filter(Boolean) as string[];
    const laneOrder = [
      '內側車道', '第一車道', 
      '中線車道', '第二車道', '第2及第3車道',
      '外側車道', '第三車道', 
      '第四車道', '第五車道'
    ];
    return dataLanes.sort((a, b) => {
      const idxA = laneOrder.indexOf(a);
      const idxB = laneOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    });
  }, [selectedRoute, selectedDirection, data]);

  // 所有日期（全部資料）
  const availableDates = useMemo(() => Array.from(new Set(data.map(d => d.date))).sort((a, b) => b.localeCompare(a)), [data]);

  // 僅含有 IRI 資料的日期（給色塊圖下拉使用）
  const availableIriDates = useMemo(() =>
    Array.from(new Set(
      data.filter(d => d.route === selectedRoute && d.iri > 0).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a)),
    [data, selectedRoute]
  );

  // 該路線 + 方向有資料的日期（給統計下拉使用）
  const availableStatsDates = useMemo(() =>
    Array.from(new Set(
      data.filter(d => d.route === selectedRoute && d.direction === selectedDirection).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a)),
    [data, selectedRoute, selectedDirection]
  );

  const availableIriDatesByRoute = useMemo(() =>
    Array.from(new Set(
      data.filter(d => d.route === selectedRoute && d.direction === selectedDirection && d.iri > 0).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a)),
    [data, selectedRoute, selectedDirection]
  );

  const availableSnDatesByRoute = useMemo(() =>
    Array.from(new Set(
      data.filter(d => d.route === selectedRoute && d.direction === selectedDirection && d.sn > 0).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a)),
    [data, selectedRoute, selectedDirection]
  );

  useEffect(() => {
    if (data.length > 0) {
      if (!selectedRoute || !routes.includes(selectedRoute)) setSelectedRoute(routes[0]);
      if (!selectedDate || !availableDates.includes(selectedDate)) setSelectedDate(availableDates[0]);
    }
  }, [data, routes, availableDates]);

  useEffect(() => {
    if (availableIriDatesByRoute.length > 0) {
      if (!selectedIriDate || !availableIriDatesByRoute.includes(selectedIriDate)) {
        setSelectedIriDate(availableIriDatesByRoute[0]);
      }
    }
  }, [availableIriDatesByRoute]);

  useEffect(() => {
    if (availableSnDatesByRoute.length > 0) {
      if (!selectedSnDate || !availableSnDatesByRoute.includes(selectedSnDate)) {
        setSelectedSnDate(availableSnDatesByRoute[0]);
      }
    }
  }, [availableSnDatesByRoute]);

  useEffect(() => {
    if (availableDirections.length > 0 && !availableDirections.includes(selectedDirection)) {
      setSelectedDirection(availableDirections[0]);
    }
  }, [availableDirections, selectedDirection]);

  useEffect(() => {
    if (availableLanes.length > 0 && !availableLanes.includes(selectedLane)) {
      setSelectedLane(availableLanes[0]);
    }
  }, [availableLanes, selectedLane]);

  /** 通用上傳處理：擷取檔案後開啟精靈 */
  const handleRawIriUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setWizardState({ files: Array.from(files), type: 'iri' });
    }
    event.target.value = ''; // 允許重複選同一個檔案
  };

  const handleRawSnUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setWizardState({ files: Array.from(files), type: 'sn' });
    }
    event.target.value = '';
  };

  const handleWizardConfirm = async (rule: MappingRule) => {
    if (!wizardState) return;
    const { files, type } = wizardState;
    setWizardState(null);
    setUploading(true);

    let allParsed: any[] = [];
    
    // 1. 本地高速解析階段
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pending: UploadResult = { type, fileName: file.name, parsed: 0, inserted: 0, status: 'parsing' };
      setUploadResults(prev => [...prev, pending]);

      try {
        const parsed = await parseWithMapping([file], rule, type);
        if (parsed.length === 0) {
          setUploadResults(prev => prev.map(r => r === pending ? { ...r, status: 'error', message: '未抓取到有效資料' } : r));
        } else {
          allParsed = allParsed.concat(parsed);
          setUploadResults(prev => prev.map(r => r === pending ? { ...r, parsed: parsed.length, status: 'idle', message: '解析完成，等待合併寫入' } : r));
        }
      } catch (err: any) {
        setUploadResults(prev => prev.map(r => r === pending ? { ...r, status: 'error', message: String(err?.message ?? err) } : r));
      }
    }

    // 2. 批次分塊上傳階段 (Batch Chunking)
    if (allParsed.length > 0) {
      
      const parseMileageToNumber = (raw: any): number => {
        if (typeof raw === 'number') return raw > 1000 ? raw / 1000 : raw;
        const str = String(raw || '');
        // 處理 "166k+500" 或 "166+500"
        const match = str.match(/(\d+)[kK\+]?\+?(\d+)/);
        if (match) {
          return parseInt(match[1], 10) + parseInt(match[2], 10) / 1000;
        }
        const num = parseFloat(str);
        return isNaN(num) ? 0 : (num > 1000 ? num / 1000 : num);
      };

      const normalizeDateStr = (raw: any): string => {
        if (!raw) return new Date().toISOString().split('T')[0];
        let s = String(raw).trim();
        if (s.includes('T') && s.endsWith('Z')) {
           const d = new Date(s);
           if (!isNaN(d.getTime())) {
               const y = d.getFullYear();
               const m = String(d.getMonth() + 1).padStart(2, '0');
               const day = String(d.getDate()).padStart(2, '0');
               s = `${y}-${m}-${day}`;
           } else {
               s = s.split('T')[0];
           }
        } else if (s.includes('T')) {
            s = s.split('T')[0];
        }
        if (/^20\d{6}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        s = s.replace(/[\/\.]/g, '-');
        const parts = s.split('-');
        if (parts.length === 3) {
            parts[1] = parts[1].padStart(2, '0');
            parts[2] = parts[2].padStart(2, '0');
            s = parts.join('-');
        }
        return s;
      };

      // 無論有沒有 GAS，先把資料更新到本地儀表板
      const mappedToPavementData = allParsed.map(p => ({
        date: normalizeDateStr(p.date),
        route: p.route || '未知路線',
        direction: p.direction || '未知方向',
        lane: normalizeLane(p.lane),
        mileage: parseMileageToNumber(p.mileage),
        iri: p.avgIri ? Number(p.avgIri) : 0,
        sn: p.sn ? Number(p.sn) : 0,
        prqi: p.avgPrqi ? Number(p.avgPrqi) : 0
      }));
      setDataPersist(prev => [...prev, ...mappedToPavementData]);

      if (GAS_URL) {
        // ── 有 GAS：分塊上傳 ──
        setUploadResults(prev => prev.map(r =>
          (r.type === type && r.status === 'idle')
            ? { ...r, status: 'uploading', message: '正在寫入資料庫...' }
            : r
        ));

        const CHUNK_SIZE = 500;
        let totalInserted = 0;
        let hasError = false;

        for (let i = 0; i < allParsed.length; i += CHUNK_SIZE) {
          const chunk = allParsed.slice(i, i + CHUNK_SIZE);
          setUploadResults(prev => prev.map(r =>
            (r.type === type && r.status === 'uploading')
              ? { ...r, message: `寫入中... (${Math.min(i + CHUNK_SIZE, allParsed.length)} / ${allParsed.length} 筆)` }
              : r
          ));
          try {
            const res = type === 'iri' ? await uploadIRIData(chunk) : await uploadSNData(chunk);
            if (res.success) totalInserted += (res.inserted ?? chunk.length);
            else hasError = true;
          } catch {
            hasError = true;
          }
        }

        setUploadResults(prev => prev.map(r =>
          (r.type === type && r.status === 'uploading')
            ? {
                ...r,
                status: (hasError && totalInserted === 0) ? 'error' : 'done',
                inserted: totalInserted || r.parsed,
                message: hasError ? `部分失敗，已寫入 ${totalInserted} 筆` : ''
              }
            : r
        ));

      } else {
        setUploadResults(prev => prev.map(r =>
          (r.type === type && r.status === 'idle')
            ? { ...r, status: 'done', inserted: r.parsed, message: '已寫入本地資料庫' }
            : r
        ));
      }
    }

    setUploading(false);
  };

  const clearLocalData = () => {
    localStorage.removeItem(LS_KEY);
    setDataPersist([]);
  };

  // 色塊圖：依路線 + 方向 + 日期筛選（不筛車道，顯示所有車道）
  const colorMapData = useMemo(() => {
    return data.filter(d =>
      d.route === selectedRoute &&
      d.direction === selectedDirection &&
      d.date === selectedDate
    );
  }, [data, selectedRoute, selectedDirection, selectedDate]);

  // 趣勢圖用（保留車道筛選）
  const currentViewData = useMemo(() => {
    return data.filter(d =>
      d.route === selectedRoute &&
      d.direction === selectedDirection &&
      d.date === selectedDate &&
      (!selectedLane || d.lane === selectedLane)
    );
  }, [data, selectedRoute, selectedDirection, selectedDate, selectedLane]);

  const stats = useMemo(() => {
    if (activeTab !== 'trends') return null;
    
    const routeData = data.filter(d => d.route === selectedRoute && d.direction === selectedDirection);
    
    const iriData = selectedIriDate ? routeData.filter(d => 
      d.date === selectedIriDate && 
      d.iri > 0 && 
      (!selectedLane || d.lane === selectedLane)
    ) : [];
    
    const snData = selectedSnDate ? routeData.filter(d => 
      d.date === selectedSnDate && 
      d.sn > 0 && 
      (!selectedLane || d.lane === selectedLane)
    ) : [];

    const avgIri = iriData.length > 0 ? iriData.reduce((acc, curr) => acc + curr.iri, 0) / iriData.length : 0;
    const avgSn = snData.length > 0 ? snData.reduce((acc, curr) => acc + curr.sn, 0) / snData.length : 0;

    const pct175 = iriData.length > 0 ? (iriData.filter(d => d.iri >= 1.75).length / iriData.length * 100) : 0;
    const pct20 = iriData.length > 0 ? (iriData.filter(d => d.iri >= 2.0).length / iriData.length * 100) : 0;
    const pct25 = iriData.length > 0 ? (iriData.filter(d => d.iri >= 2.5).length / iriData.length * 100) : 0;

    const countSn35 = snData.filter(d => d.sn > 0 && d.sn < 35).length;

    const allStatsData = [...iriData, ...snData];
    const mileages: number[] = Array.from(new Set<number>(allStatsData.map(d => d.mileage)));
    const totalLength = mileages.length > 0 ? Math.max(...mileages) - Math.min(...mileages) : 0;

    return {
      avgIri: avgIri.toFixed(2),
      avgSn: avgSn.toFixed(1),
      pct175: pct175.toFixed(1),
      pct20: pct20.toFixed(1),
      pct25: pct25.toFixed(1),
      countSn35,
      totalLength: totalLength.toFixed(1),
      iriDate: selectedIriDate,
      snDate: selectedSnDate
    };
  }, [data, selectedRoute, selectedDirection, selectedIriDate, selectedSnDate, activeTab]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {wizardState && (
        <ImportWizard 
          files={wizardState.files} 
          type={wizardState.type} 
          onConfirm={handleWizardConfirm} 
          onCancel={() => setWizardState(null)} 
        />
      )}
      
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Map className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-3">
              高速公路鋪面檢測分析平台
              {isSyncing && (
                <span className="text-xs font-normal text-blue-500 bg-blue-50 px-2 py-1 rounded-full flex items-center gap-1 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  同步最新資料庫中...
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              multiple
              className="hidden" 
              ref={iriFileInputRef}
              onChange={handleRawIriUpload}
            />
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              multiple
              className="hidden" 
              ref={snFileInputRef}
              onChange={handleRawSnUpload}
            />
            {uploading && (
              <span className="flex items-center gap-1 text-sm text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                處理中...
              </span>
            )}
            {GAS_URL && (
              <button
                onClick={syncFromDB}
                disabled={isSyncing}
                className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                title="從資料庫重新同步（清除本地快取）"
              >
                <Loader2 className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? '同步中...' : '重新同步'}
              </button>
            )}
            <button 
              onClick={() => iriFileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Upload className="w-4 h-4" />
              匯入原始 IRI
            </button>
            <button 
              onClick={() => snFileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-200 rounded-lg text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors"
            >
              <Upload className="w-4 h-4" />
              匯入原始 SN
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {data.length === 0 && uploadResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Activity className="w-16 h-16 text-slate-300 mb-4" />
            <h2 className="text-xl font-medium text-slate-700 mb-2">尚未載入資料</h2>
            <p className="mb-6">請點擊上方按鈕匯入檢測資料檔案開始分析。</p>
            <div className="flex gap-4">
              <button 
                onClick={() => iriFileInputRef.current?.click()}
                className="px-6 py-2.5 bg-blue-50 border border-blue-200 rounded-lg font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                匯入 IRI 報表
              </button>
              <button 
                onClick={() => snFileInputRef.current?.click()}
                className="px-6 py-2.5 bg-orange-50 border border-orange-200 rounded-lg font-medium text-orange-700 hover:bg-orange-100 transition-colors"
              >
                匯入 SN 報表
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-2">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                  <Filter className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">資料篩選條件</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 路線 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                    <Map className="w-3.5 h-3.5 text-slate-400" /> 路線
                  </label>
                  <select 
                    value={selectedRoute} 
                    onChange={(e) => setSelectedRoute(e.target.value)}
                    className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2.5 px-3 text-sm font-medium text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm hover:border-blue-300 appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                  >
                    {routes.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                
                {activeTab === 'trends' && (
                  <>
                    {/* 方向 */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                        <Compass className="w-3.5 h-3.5 text-slate-400" /> 方向
                      </label>
                      <select 
                        value={selectedDirection} 
                        onChange={(e) => setSelectedDirection(e.target.value)}
                        className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2.5 px-3 text-sm font-medium text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm hover:border-blue-300 appearance-none cursor-pointer"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                      >
                        {availableDirections.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    {/* 車道 */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                        <Layers className="w-3.5 h-3.5 text-slate-400" /> 車道
                      </label>
                      <select 
                        value={selectedLane} 
                        onChange={(e) => setSelectedLane(e.target.value)}
                        className="w-full border border-slate-200 bg-slate-50 rounded-lg py-2.5 px-3 text-sm font-medium text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm hover:border-blue-300 appearance-none cursor-pointer"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                      >
                        {availableLanes.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </>
                )}


              </div>
            </div>

            {/* 上傳結果列表 */}
            {uploadResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-500" />
                    上傳紀錄
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={clearLocalData}
                      className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                      title="清除本地資料庫（localStorage）"
                    >
                      清除本地資料庫
                    </button>
                    <button
                      onClick={() => setUploadResults([])}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      清除紀錄
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {uploadResults.map((r, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3">
                      {/* 類型標籤 */}
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${
                        r.type === 'iri' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {r.type.toUpperCase()}
                      </span>
                      {/* 檔名 */}
                      <span className="flex-1 text-sm text-slate-700 truncate" title={r.fileName}>{r.fileName}</span>
                      {/* 狀態 */}
                      {r.status === 'parsing' && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Loader2 className="w-3 h-3 animate-spin" />解析中
                        </span>
                      )}
                      {r.status === 'uploading' && (
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <Loader2 className="w-3 h-3 animate-spin" />寫入資料庫 ({r.parsed} 筆)
                        </span>
                      )}
                      {r.status === 'done' && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="w-3 h-3" />
                          已匯入 {r.inserted} 筆
                          {r.message && <span className="text-slate-400"> {r.message}</span>}
                        </span>
                      )}
                      {r.status === 'error' && (
                        <span className="flex items-center gap-1 text-xs text-red-500" title={r.message}>
                          <AlertTriangle className="w-3 h-3" />
                          失敗：{r.message?.slice(0, 60)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs Navigation */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'trends'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  歷年趨勢圖 (依里程)
                </div>
              </button>
              <button
                onClick={() => setActiveTab('iri-map')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'iri-map'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Map className="w-4 h-4" />
                  IRI 色塊圖
                </div>
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'trends' && (
              data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-white rounded-xl border border-slate-200">
                  <p className="text-sm">請上傳歷史 CSV 資料以顯示趨勢圖</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {stats && (
                    <div className="bg-slate-100 p-4 rounded-xl border border-slate-200">
                      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 mr-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          統計比較週期設定
                        </h4>
                        
                        {/* IRI 日期選單 */}
                        <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-blue-100 shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold">IRI</span>
                            <span className="text-xs font-bold text-slate-600">檢測日期</span>
                          </div>
                          <select
                            value={selectedIriDate}
                            onChange={(e) => setSelectedIriDate(e.target.value)}
                            className="border border-slate-200 bg-slate-50 rounded-lg py-1 px-3 text-xs font-bold text-blue-700 outline-none cursor-pointer hover:border-blue-400 transition-colors"
                          >
                            {availableIriDatesByRoute.length > 0 ? (
                              availableIriDatesByRoute.map(y => <option key={y} value={y}>{y}</option>)
                            ) : (
                              <option value="">無檢測資料</option>
                            )}
                          </select>
                        </div>

                        {/* SN 日期選單 */}
                        <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-purple-100 shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-600 text-[10px] font-bold">SN</span>
                            <span className="text-xs font-bold text-slate-600">檢測日期</span>
                          </div>
                          <select
                            value={selectedSnDate}
                            onChange={(e) => setSelectedSnDate(e.target.value)}
                            className="border border-slate-200 bg-slate-50 rounded-lg py-1 px-3 text-xs font-bold text-purple-700 outline-none cursor-pointer hover:border-purple-400 transition-colors"
                          >
                            {availableSnDatesByRoute.length > 0 ? (
                              availableSnDatesByRoute.map(y => <option key={y} value={y}>{y}</option>)
                            ) : (
                              <option value="">無檢測資料</option>
                            )}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-blue-600">
                            <Activity className="w-4 h-4" />
                            <span className="text-xs font-medium">平均 IRI</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.avgIri}</p>
                          {stats.iriDate && <span className="text-[10px] text-slate-400 mt-1">{stats.iriDate} 檢測</span>}
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-purple-600">
                            <Activity className="w-4 h-4" />
                            <span className="text-xs font-medium">平均 SN</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.avgSn}</p>
                          {stats.snDate && <span className="text-[10px] text-slate-400 mt-1">{stats.snDate} 檢測</span>}
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-yellow-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-medium">IRI ≥ 1.75</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.pct175}%</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-orange-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-medium">IRI ≥ 2.0</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.pct20}%</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-medium">IRI ≥ 2.5</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.pct25}%</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-medium">SN &lt; 35</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.countSn35} 處</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">分析長度</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.totalLength} km</p>
                        </div>
                      </div>
                    </div>
                  )}
                  <MileageTrendChart data={data} route={selectedRoute} direction={selectedDirection} lane={selectedLane} type="iri" />
                  <MileageTrendChart data={data} route={selectedRoute} direction={selectedDirection} lane={selectedLane} type="prqi" />
                  <MileageTrendChart data={data} route={selectedRoute} direction={selectedDirection} lane={selectedLane} type="sn" />
                </div>
              )
            )}

            {activeTab === 'iri-map' && (() => {
              const iriDate = availableIriDates.includes(selectedDate) ? selectedDate : (availableIriDates[0] || '');
              const iriData = data.filter(d =>
                d.route === selectedRoute &&
                d.iri > 0 &&
                d.date === iriDate
              );
              return availableIriDates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-white rounded-xl border border-slate-200">
                  <p className="text-sm">目前資料庫中沒有 IRI 檢測資料。</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" /> 檢測日期：
                    </label>
                    <select
                      value={iriDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="border border-slate-300 bg-white rounded-lg py-1.5 px-3 text-sm font-medium text-slate-700 outline-none cursor-pointer"
                    >
                      {availableIriDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  {availableDirections.map(dir => (
                    <ColorMap 
                      key={dir}
                      data={iriData.filter(d => d.direction === dir)} 
                      title={`${iriDate} ${selectedRoute} - ${dir} 全段 IRI 分布圖`} 
                    />
                  ))}
                </div>
              );
            })()}

          </div>
        )}
      </main>
    </div>
  );
}
