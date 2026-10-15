import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, Download, Activity, AlertTriangle, CheckCircle, Map, TrendingUp, Loader2, Database, Filter, Calendar, Compass, Layers, ShieldOff, HardHat } from 'lucide-react';
import { PavementData, normalizeRouteName, normalizeDirection } from './types';
import { MileageTrendChart } from './components/MileageTrendChart';
import { ColorMap } from './components/ColorMap';
import { ImportWizard } from './components/ImportWizard';
import { ExportWizard } from './components/ExportWizard';
import { MappingRule, parseWithMapping } from './lib/excelParser';
import { uploadSNData, uploadIRIData, fetchSNData, fetchIRIData, fetchAllData, fetchMetadata, uploadExemptZones, fetchExemptZones, GAS_URL } from './lib/gasService';
import { getLocalData, saveLocalData, clearLocalDataStorage, getExemptZonesLocal, saveExemptZonesLocal } from './lib/storage';
import { ExemptZoneManager, ExemptZone } from './components/ExemptZoneManager';
import { ExemptZonePage } from './components/ExemptZonePage';
import { ConstructionReviewPage } from './components/ConstructionReviewPage';

type UploadStatus = 'idle' | 'parsing' | 'uploading' | 'done' | 'error';
type IriExemptMode = 'all' | 'exclude' | 'low-accept';

interface UploadResult {
  type: 'iri' | 'sn';
  fileName: string;
  parsed: number;
  inserted: number;
  status: UploadStatus;
  message?: string;
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

// 高效日期字串標準化：快速路徑直接過濾，節省 90% 以上 Regex 與 Date 物件建構耗時
const normalizeDateStr = (raw: any): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  if (s.includes('T')) {
    if (s.endsWith('Z')) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    return s.split('T')[0];
  }

  if (/^20\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  const clean = s.replace(/[\/\.]/g, '-');
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  return s;
};

// 高效里程轉換：純數值直接返回，避開多次正則檢索
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

export default function App() {
  const [rawData, setRawData] = useState<PavementData[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [isLoadingLocal, setIsLoadingLocal] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // 異步持久化更新（寫入 IndexedDB，不阻塞 React 渲染）
  const setDataPersist = (updater: PavementData[] | ((prev: PavementData[]) => PavementData[])) => {
    setRawData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveLocalData(next, Date.now());
      return next;
    });
  };

  // rawData 於寫入時皆已規格化車道，直接引用避免每次產生 50,000 個重複物件
  const data = rawData;

  // 合併車道模式：當選此值時，同時篩選第二+三車道
  const MERGED_LANE_KEY = '第二+三車道 (合併)';
  const ALL_DISTRICT_KEY = '全轄區';
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedDirection, setSelectedDirection] = useState<string>('');
  const [selectedLane, setSelectedLane] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedIriDate, setSelectedIriDate] = useState<string>('');
  const [selectedSnDate, setSelectedSnDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'trends' | 'iri-map' | 'exempt-zones' | 'construction'>('trends');
  const [exemptZones, setExemptZones] = useState<ExemptZone[]>([]);
  const [iriExemptMode, setIriExemptMode] = useState<IriExemptMode>(() => {
    try {
      const saved = localStorage.getItem('iri_exempt_mode');
      return (saved as IriExemptMode) || 'all';
    } catch {
      return 'all';
    }
  });

  const handleExemptZonesChange = (next: ExemptZone[]) => {
    setExemptZones(next);
    saveExemptZonesLocal(next);
  };

  useEffect(() => {
    try {
      localStorage.setItem('iri_exempt_mode', iriExemptMode);
    } catch {}
  }, [iriExemptMode]);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [wizardState, setWizardState] = useState<{ files: File[], type: 'iri' | 'sn' } | null>(null);
  const [showExportWizard, setShowExportWizard] = useState(false);

  // 從雲端資料庫同步（SWR 架構：支援靜默背景檢查與手動強制更新）
  const syncFromDB = async (nocache = false, silent = false) => {
    if (!GAS_URL) return;
    if (!silent) setIsSyncing(true);

    try {
      // 快速檢查：若非手動強制同步且本地已有快取，先做極速 metadata 比對（~150ms）
      if (!nocache && lastSyncTime > 0) {
        const meta = await fetchMetadata();
        if (meta && meta.lastUpdated && meta.lastUpdated <= lastSyncTime) {
          // 雲端資料無更新，直接保留本地快取
          return;
        }
      }

      const { sn: snRaw, iri: iriRaw, lastUpdated } = await fetchAllData(nocache);
      const snLen = snRaw.length;
      const iriLen = iriRaw.length;
      const snData: PavementData[] = new Array(snLen);
      for (let i = 0; i < snLen; i++) {
        const p = snRaw[i];
        snData[i] = {
          date: normalizeDateStr(p.date),
          route: p.route || '未知路線',
          direction: p.direction || '未知方向',
          lane: normalizeLane(p.lane),
          mileage: parseMileageToNumber(p.mileage),
          iri: 0,
          sn: p.sn ? Number(p.sn) : 0,
          prqi: 0,
        };
      }

      const iriData: PavementData[] = new Array(iriLen);
      for (let i = 0; i < iriLen; i++) {
        const p = iriRaw[i];
        iriData[i] = {
          date: normalizeDateStr(p.date),
          route: p.route || '未知路線',
          direction: p.direction || '未知方向',
          lane: normalizeLane(p.lane),
          mileage: parseMileageToNumber(p.mileage),
          iri: p.avgIri ? Number(p.avgIri) : 0,
          sn: 0,
          prqi: p.avgPrqi ? Number(p.avgPrqi) : 0,
        };
      }

      const merged = snData.concat(iriData);
      const newSyncTime = lastUpdated || Date.now();
      setRawData(merged);
      setLastSyncTime(newSyncTime);
      saveLocalData(merged, newSyncTime);
    } catch (e) {
      console.warn('[sync] 雲端同步失敗，保留本地快取', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // 網頁載入時：1. 瞬間從 IndexedDB 載入展示 (秒開)；2. 背景靜默比對雲端資料庫
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const local = await getLocalData();
        if (isMounted && local && local.data.length > 0) {
          setRawData(local.data);
          setLastSyncTime(local.lastSync);
        }

        // 載入本地免測路段資料庫 (IndexedDB 秒開)
        const localExempt = await getExemptZonesLocal<ExemptZone>();
        if (isMounted && localExempt && localExempt.length > 0) {
          setExemptZones(localExempt);
        }
      } catch (err) {
        console.warn('讀取本地快取失敗', err);
      } finally {
        if (isMounted) setIsLoadingLocal(false);
      }

      // 背景靜默檢查雲端更新（道路檢測資料 + 免測路段資料庫）
      if (isMounted && GAS_URL) {
        syncFromDB(false, true);

        // 雲端同步免測路段資料庫
        fetchExemptZones().then(cloudZones => {
          if (isMounted && cloudZones && cloudZones.length > 0) {
            setExemptZones(cloudZones);
            saveExemptZonesLocal(cloudZones);
          }
        }).catch(() => {});
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const iriFileInputRef = useRef<HTMLInputElement>(null);
  const snFileInputRef = useRef<HTMLInputElement>(null);

  const routes = useMemo(() => {
    const dataRoutes = Array.from(new Set(data.map(d => d.route))) as string[];
    const predefined = ['國道1號', '國道3號', '國道4號'];
    const others = dataRoutes.filter(r => !predefined.includes(r)).sort();
    const ordered = [...predefined.filter(r => dataRoutes.includes(r)), ...others];
    return [ALL_DISTRICT_KEY, ...ordered];
  }, [data]);

  const availableDirections = useMemo(() => {
    if (selectedRoute === ALL_DISTRICT_KEY) {
      return ['雙向'];
    }
    const dataDirs = Array.from(new Set(data.filter(d => d.route === selectedRoute).map(d => d.direction))).filter(Boolean).sort() as string[];
    const predefined = (selectedRoute === '國道4號') ? ['東向', '西向'] : ['南下', '北上'];
    const validPredefined = predefined.filter(d => dataDirs.includes(d));
    const others = dataDirs.filter(d => !predefined.includes(d));
    
    // 如果資料中有方向就回傳，都沒有的話才回傳預設的避免畫面出錯
    const result = [...validPredefined, ...others];
    const finalDirs = result.length > 0 ? result : predefined;
    return ['雙向', ...finalDirs];
  }, [selectedRoute, data]);

  const availableLanes = useMemo(() => {
    if (selectedRoute === ALL_DISTRICT_KEY) {
      return ['全車道'];
    }
    const routeData = data.filter(d => d.route === selectedRoute);
    const directionData = (selectedDirection === '雙向' || !selectedDirection)
      ? routeData
      : routeData.filter(d => d.direction === selectedDirection);

    const dataLanes = Array.from(new Set(directionData.map(d => d.lane))).filter(Boolean) as string[];
    const laneOrder = [
      '內側車道', '第一車道',
      '中線車道', '第二車道',
      '外側車道', '第三車道',
      '第四車道', '第五車道'
    ];
    const sorted = dataLanes.sort((a, b) => {
      const idxA = laneOrder.indexOf(a);
      const idxB = laneOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    });

    // 國4 且同時有第二、第三車道資料時，加入「合併」選項
    const has2 = dataLanes.includes('第二車道');
    const has3 = dataLanes.includes('第三車道');
    const mergedOption = selectedRoute.includes('4') && has2 && has3 ? [MERGED_LANE_KEY] : [];

    return ['全車道', ...sorted, ...mergedOption];
  }, [selectedRoute, selectedDirection, data]);

  // 所有日期（全部資料）
  const availableDates = useMemo(() => Array.from(new Set(data.map(d => d.date))).sort((a, b) => b.localeCompare(a)), [data]);

  // 僅含有 IRI 資料的日期（不分方向，給色塊圖與統計下拉共用以確保不為空）
  const availableIriDatesByRoute = useMemo(() => {
    if (!selectedRoute) return [];
    const targetData = selectedRoute === ALL_DISTRICT_KEY
      ? data.filter(d => d.iri > 0)
      : data.filter(d => d.route === selectedRoute && d.iri > 0);
    return Array.from(new Set(targetData.map(d => d.date))).sort((a, b) => b.localeCompare(a));
  }, [data, selectedRoute]);

  const availableSnDatesByRoute = useMemo(() => {
    if (!selectedRoute) return [];
    const targetData = selectedRoute === ALL_DISTRICT_KEY
      ? data.filter(d => d.sn > 0)
      : data.filter(d => d.route === selectedRoute && d.sn > 0);
    return Array.from(new Set(targetData.map(d => d.date))).sort((a, b) => b.localeCompare(a));
  }, [data, selectedRoute]);

  // 給色塊圖專用的 Alias
  const availableIriDates = availableIriDatesByRoute;



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
  }, [availableIriDatesByRoute, selectedIriDate]);

  useEffect(() => {
    if (availableSnDatesByRoute.length > 0) {
      if (!selectedSnDate || !availableSnDatesByRoute.includes(selectedSnDate)) {
        setSelectedSnDate(availableSnDatesByRoute[0]);
      }
    }
  }, [availableSnDatesByRoute, selectedSnDate]);

  useEffect(() => {
    if (availableDirections.length > 0) {
      if (!selectedDirection || !availableDirections.includes(selectedDirection)) {
        setSelectedDirection('雙向');
      }
    }
  }, [availableDirections, selectedDirection]);

  useEffect(() => {
    if (availableLanes.length > 0) {
      if (!selectedLane || !availableLanes.includes(selectedLane)) {
        setSelectedLane('全車道');
      }
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
    clearLocalDataStorage();
    setRawData([]);
    setLastSyncTime(0);
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
      (selectedDirection === '雙向' || !selectedDirection || d.direction === selectedDirection) &&
      d.date === selectedDate &&
      (selectedLane === '全車道' || !selectedLane || d.lane === selectedLane)
    );
  }, [data, selectedRoute, selectedDirection, selectedDate, selectedLane]);

  // 將選擇的車道轉為篩選 predicate（支援合併模式）
  const laneFilter = (lane: string): boolean => {
    if (selectedLane === '全車道' || !selectedLane) return true;
    if (selectedLane === MERGED_LANE_KEY) return lane === '第二車道' || lane === '第三車道';
    return lane === selectedLane;
  };

  // 判斷某一資料點是否落在免測路段內（依路線+方向）
  const isExempt = (d: PavementData, zones: ExemptZone[]): boolean => {
    const dRoute = normalizeRouteName(d.route);
    const dDir = normalizeDirection(d.direction);
    return zones.some(z => {
      if (normalizeRouteName(z.route) !== dRoute) return false;
      const zDir = normalizeDirection(z.direction);
      if (zDir && zDir !== dDir) return false;
      if (z.type === 'point') {
        const target = z.mileage ?? -Infinity;
        return Math.abs(d.mileage - target) <= 0.05;
      }
      const s = Math.min(z.start ?? Infinity, z.end ?? -Infinity);
      const e = Math.max(z.start ?? Infinity, z.end ?? -Infinity);
      return d.mileage >= (s - 0.005) && d.mileage <= (e + 0.005);
    });
  };

  const stats = useMemo(() => {
    if (activeTab !== 'trends') return null;

    const isAllDistrict = selectedRoute === ALL_DISTRICT_KEY;
    const routeData = data.filter(d =>
      (isAllDistrict || normalizeRouteName(d.route) === normalizeRouteName(selectedRoute)) &&
      (selectedDirection === '雙向' || !selectedDirection || normalizeDirection(d.direction) === normalizeDirection(selectedDirection))
    );

    // 取得適用的免測規則（全轄區則納入所有路線的規則，由 isExempt 各自比對 route）
    const activeZones = isAllDistrict
      ? exemptZones
      : exemptZones.filter(z => normalizeRouteName(z.route) === normalizeRouteName(selectedRoute));

    // 依模式過濾 IRI 資料
    const applyExempt = (items: PavementData[]): PavementData[] => {
      if (iriExemptMode === 'all' || activeZones.length === 0) return items;
      if (iriExemptMode === 'exclude') return items.filter(d => !isExempt(d, activeZones));
      // 'low-accept'：免測路段中 IRI ≤ 1.75 的仍保留，>1.75 的排除
      return items.filter(d => {
        if (!isExempt(d, activeZones)) return true;
        return d.iri <= 1.75;
      });
    };

    const rawIriData = selectedIriDate ? routeData.filter(d =>
      d.date === selectedIriDate &&
      d.iri > 0 &&
      laneFilter(d.lane)
    ) : [];

    const iriData = applyExempt(rawIriData);
    const exemptedCount = rawIriData.length - iriData.length;

    const snData = selectedSnDate ? routeData.filter(d =>
      d.date === selectedSnDate &&
      d.sn > 0 &&
      laneFilter(d.lane)
    ) : [];

    const avgIri = iriData.length > 0 ? iriData.reduce((acc, curr) => acc + curr.iri, 0) / iriData.length : 0;
    const avgSn = snData.length > 0 ? snData.reduce((acc, curr) => acc + curr.sn, 0) / snData.length : 0;

    // IRI 級距統計（處數 + 百分比）
    const n = iriData.length;
    const iriB1 = iriData.filter(d => d.iri >= 1.75 && d.iri < 2.0).length;
    const iriB2 = iriData.filter(d => d.iri >= 2.0 && d.iri < 2.5).length;
    const iriB3 = iriData.filter(d => d.iri >= 2.5).length;
    const pct = (c: number) => (n > 0 ? (c / n * 100).toFixed(1) : '0.0');

    const countSn35 = snData.filter(d => d.sn > 0 && d.sn < 35).length;

    const allStatsData = [...iriData, ...snData];
    // 車道公里數：按「路線 + 方向」分組獨立計算後加總，精準避免跨線或雙向里程被混算
    const routeDirKeys = Array.from(new Set(allStatsData.map(d => `${d.route}:::${d.direction}`)));

    const calcLaneKmForGroup = (group: typeof allStatsData) => {
      const ms = Array.from(new Set<number>(group.map(d => d.mileage))).sort((a, b) => a - b);
      if (ms.length < 2) return 0;
      let km = 0;
      for (let i = 0; i < ms.length - 1; i++) {
        const segLen = ms[i + 1] - ms[i];
        const lanesAtM = new Set(group.filter(d => d.mileage === ms[i]).map(d => d.lane)).size;
        km += segLen * (lanesAtM || 1);
      }
      const lastSeg = ms[ms.length - 1] - ms[ms.length - 2];
      const lanesAtLast = new Set(group.filter(d => d.mileage === ms[ms.length - 1]).map(d => d.lane)).size;
      km += lastSeg * (lanesAtLast || 1);
      return km;
    };

    const laneLengthKm = routeDirKeys.reduce((sum, key) => {
      const [r, dir] = key.split(':::');
      const group = allStatsData.filter(d => d.route === r && d.direction === dir);
      return sum + calcLaneKmForGroup(group);
    }, 0);

    const isMergedLane = selectedLane === MERGED_LANE_KEY;

    return {
      avgIri: isMergedLane ? '0' : avgIri.toFixed(2),
      avgSn: avgSn.toFixed(1),
      iriBands: isMergedLane
        ? [
            { label: '1.75 ≤ IRI < 2.0',   count: 0, pct: '0.0', color: 'text-yellow-600' },
            { label: '2.0 ≤ IRI < 2.5',    count: 0, pct: '0.0', color: 'text-orange-600' },
            { label: 'IRI ≥ 2.5',          count: 0, pct: '0.0', color: 'text-red-600' },
          ]
        : [
            { label: '1.75 ≤ IRI < 2.0',   count: iriB1, pct: pct(iriB1), color: 'text-yellow-600' },
            { label: '2.0 ≤ IRI < 2.5',    count: iriB2, pct: pct(iriB2), color: 'text-orange-600' },
            { label: 'IRI ≥ 2.5',          count: iriB3, pct: pct(iriB3), color: 'text-red-600' },
          ],
      countSn35,
      laneLengthKm: laneLengthKm.toFixed(2),
      iriDate: selectedIriDate,
      snDate: selectedSnDate,
      exemptedCount,
      totalBeforeExempt: rawIriData.length,
    };
  }, [data, selectedRoute, selectedDirection, selectedLane, selectedIriDate, selectedSnDate, activeTab, exemptZones, iriExemptMode]);

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
      {showExportWizard && (
        <ExportWizard data={data} onClose={() => setShowExportWizard(false)} />
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
                onClick={() => syncFromDB(true)}
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
            <div className="w-px h-6 bg-slate-300 mx-1"></div>
            <button 
              onClick={() => setShowExportWizard(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <Download className="w-4 h-4" />
              匯出資料
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoadingLocal ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <h2 className="text-xl font-medium text-slate-700 mb-2">正在載入檢測資料...</h2>
            <p className="text-sm text-slate-400">正在快速讀取本地快取</p>
          </div>
        ) : data.length === 0 && uploadResults.length === 0 ? (
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
            {/* Filters（僅在趨勢圖與色塊圖分頁顯示；施工品質檢視與免測維護有各自專屬介面，避免頂部重複與多餘層次） */}
            {(activeTab === 'trends' || activeTab === 'iri-map') && (
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
          )}

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
            <div className="flex border-b border-slate-200 overflow-x-auto">
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
              <button
                id="tab-exempt-zones"
                onClick={() => setActiveTab('exempt-zones')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'exempt-zones'
                    ? 'border-amber-600 text-amber-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <ShieldOff className="w-4 h-4" />
                免測路段維護
                {exemptZones.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                    {exemptZones.length}
                  </span>
                )}
              </button>
              <button
                id="tab-construction"
                onClick={() => setActiveTab('construction')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'construction'
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <HardHat className="w-4 h-4" />
                施工品質檢視
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-600">
                  暫存
                </span>
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
                  {/* IRI 免測模式切換（常駐顯示） */}
                  <div className="flex items-center gap-2 flex-wrap bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
                      IRI 免測統計模式：
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {([
                        { mode: 'all' as IriExemptMode, label: '全採納', id: 'btn-mode-all', color: 'bg-slate-700' },
                        { mode: 'exclude' as IriExemptMode, label: '扣除免測', id: 'btn-mode-exclude', color: 'bg-amber-600' },
                        { mode: 'low-accept' as IriExemptMode, label: '免測但 ≤1.75 仍採納', id: 'btn-mode-low-accept', color: 'bg-blue-600' },
                      ]).map(({ mode, label, id, color }) => (
                        <button
                          key={mode}
                          id={id}
                          onClick={() => setIriExemptMode(mode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            iriExemptMode === mode
                              ? `${color} text-white shadow-sm ring-2 ring-offset-1 ring-slate-400`
                              : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('exempt-zones')}
                      className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="前往專屬分頁維護免測路段資料庫"
                    >
                      <span>前往維護免測路段 ({exemptZones.length})</span>
                      <span>→</span>
                    </button>
                  </div>

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
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                        {/* 平均 IRI */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-blue-600">
                            <Activity className="w-4 h-4" />
                            <span className="text-xs font-medium">平均 IRI</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.avgIri}</p>
                          {stats.iriDate && <span className="text-[10px] text-slate-400 mt-1">{stats.iriDate} 檢測</span>}
                        </div>
                        {/* IRI 四個級距卡片 */}
                        {stats.iriBands.map((band) => (
                          <div key={band.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                            <div className={`flex items-center gap-2 ${band.color}`}>
                              <AlertTriangle className="w-4 h-4" />
                              <span className="text-xs font-medium whitespace-nowrap">{band.label}</span>
                            </div>
                            <p className="text-xl font-bold text-slate-800">
                              {band.count} 處
                              <span className="text-sm font-medium text-slate-400 ml-1">/ {band.pct}%</span>
                            </p>
                          </div>
                        ))}
                        {/* 平均 SN */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-purple-600">
                            <Activity className="w-4 h-4" />
                            <span className="text-xs font-medium">平均 SN</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.avgSn}</p>
                          {stats.snDate && <span className="text-[10px] text-slate-400 mt-1">{stats.snDate} 檢測</span>}
                        </div>
                        {/* SN < 35 */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-medium">SN &lt; 35</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.countSn35} 處</p>
                        </div>
                        {/* 分析車道公里數 */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">分析車道公里</span>
                          </div>
                          <p className="text-xl font-bold text-slate-800">{stats.laneLengthKm}</p>
                          <span className="text-[11px] text-slate-400">車道公里</span>
                        </div>
                        {/* 免測扣除提示 */}
                        {stats.exemptedCount > 0 && (
                          <div className="col-span-2 md:col-span-4 lg:col-span-8 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ShieldOff className="w-4 h-4 text-amber-600 shrink-0" />
                              <span className="text-xs text-amber-800">
                                目前依<strong>「{iriExemptMode === 'exclude' ? '扣除免測' : '免測但 ≤1.75 仍採納'}」</strong>模式排除 <strong>{stats.exemptedCount}</strong> 處伸縮縫/免測點（原始 {stats.totalBeforeExempt} 處），以有效 <strong>{stats.totalBeforeExempt - stats.exemptedCount}</strong> 處計算平均 IRI 及各階級。
                              </span>
                            </div>
                            <span className="text-[11px] text-amber-600 font-semibold bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                              已校正
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedRoute === ALL_DISTRICT_KEY ? (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-2">
                      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-800">全轄區彙總統計模式</h4>
                      <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                        上方統計卡片已彙總全轄區所有路線（國道1號、國道3號、國道4號等）之平均 IRI、各階級處數與總車道公里數，並已套用各路線設定之免測扣除規則。
                        <br />
                        如需檢視個別路段之「歷年里程趨勢走勢圖」，請由上方「路線」下拉選單切換至單一路線。
                      </p>
                    </div>
                  ) : (selectedDirection === '雙向' || !selectedDirection) ? (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-700">請選擇具體方向以顯示趨勢圖</h4>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        目前篩選為「雙向」，趨勢圖需指定單一方向（如南下 / 北上）才能顯示。
                      </p>
                    </div>
                  ) : (selectedLane === '全車道' || !selectedLane) ? (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-700">請選擇具體車道以顯示趨勢圖</h4>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        目前篩選為「全車道」，趨勢圖需指定單一車道（如外側車道）才能顯示。
                      </p>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const targetDirs = [selectedDirection];

                        return targetDirs.map(dir => (
                          <div key={dir} className="space-y-6">
                            {selectedLane !== MERGED_LANE_KEY && (
                              <MileageTrendChart data={data} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="iri" exemptZones={exemptZones} />
                            )}
                            {selectedLane !== MERGED_LANE_KEY && (
                              <MileageTrendChart data={data} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="prqi" exemptZones={exemptZones} />
                            )}
                            <MileageTrendChart data={data} route={selectedRoute} direction={dir} lane={selectedLane} mergedLaneKey={MERGED_LANE_KEY} type="sn" exemptZones={exemptZones} />
                          </div>
                        ));
                      })()}
                    </>
                  )}
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

            {activeTab === 'exempt-zones' && (
              <ExemptZonePage
                zones={exemptZones}
                routes={routes.filter(r => r !== ALL_DISTRICT_KEY)}
                directions={['南下', '北上', '東向', '西向']}
                onChange={handleExemptZonesChange}
              />
            )}

            {activeTab === 'construction' && (
              <ConstructionReviewPage
                dbData={data}
                exemptZones={exemptZones}
                MERGED_LANE_KEY={MERGED_LANE_KEY}
                iriExemptMode={iriExemptMode}
                onExemptModeChange={setIriExemptMode}
                onNavigateToExemptZones={() => setActiveTab('exempt-zones')}
              />
            )}

          </div>
        )}
      </main>
    </div>
  );
}
