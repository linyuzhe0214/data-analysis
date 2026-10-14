import React, { useState, useMemo, useRef } from 'react';
import {
  Upload, Trash2, HardHat, Activity, AlertTriangle, CheckCircle,
  Loader2, GitCompare, Compass, Layers, Map, TrendingUp,
  ShieldOff, ShieldAlert, ArrowDown, ArrowUp, Calendar
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

export type IriExemptMode = 'all' | 'exclude' | 'low-accept';

export interface ConstructionSegment {
  start: number;
  end: number;
}

interface Props {
  dbData: PavementData[];
  exemptZones: ExemptZone[];
  MERGED_LANE_KEY: string;
  iriExemptMode?: IriExemptMode;
  onExemptModeChange?: (mode: IriExemptMode) => void;
  onNavigateToExemptZones?: () => void;
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

export const ConstructionReviewPage: React.FC<Props> = ({
  dbData,
  exemptZones,
  MERGED_LANE_KEY,
  iriExemptMode: propIriExemptMode,
  onExemptModeChange,
  onNavigateToExemptZones,
}) => {
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

  // ── IRI 免測統計模式
  const [localIriExemptMode, setLocalIriExemptMode] = useState<IriExemptMode>(() => {
    try {
      const saved = localStorage.getItem('iri_exempt_mode');
      return (saved as IriExemptMode) || 'all';
    } catch {
      return 'all';
    }
  });

  const currentIriExemptMode = propIriExemptMode || localIriExemptMode;

  const handleModeChange = (mode: IriExemptMode) => {
    if (onExemptModeChange) onExemptModeChange(mode);
    setLocalIriExemptMode(mode);
    try { localStorage.setItem('iri_exempt_mode', mode); } catch {}
  };

  // ── 篩選
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedDirection, setSelectedDirection] = useState('雙向');
  const [selectedLane, setSelectedLane] = useState('全車道');
  const [selectedIriDate, setSelectedIriDate] = useState('');
  const [selectedSnDate, setSelectedSnDate] = useState('');

  // ── 前後對比模式
  const [compareMode, setCompareMode] = useState(false);
  const [selectedDbIriDate, setSelectedDbIriDate] = useState('');
  const [selectedDbSnDate, setSelectedDbSnDate] = useState('');
  const [chartViewMode, setChartViewMode] = useState<'overlay' | 'split'>('overlay');

  const iriFileRef = useRef<HTMLInputElement>(null);
  const snFileRef = useRef<HTMLInputElement>(null);

  // ── 派生選項
  const routes = useMemo(() => {
    const list = Array.from(new Set(constData.map(d => d.route))).sort();
    return ['全轄區', ...list];
  }, [constData]);

  const availableDirections = useMemo(() => {
    const dirs = Array.from(new Set(
      constData.filter(d => !selectedRoute || selectedRoute === '全轄區' || d.route === selectedRoute).map(d => d.direction)
    )).filter(Boolean).sort() as string[];
    return ['雙向', ...dirs];
  }, [constData, selectedRoute]);

  const availableLanes = useMemo(() => {
    const lanes = Array.from(new Set(
      constData
        .filter(d => (!selectedRoute || selectedRoute === '全轄區' || d.route === selectedRoute) &&
          (selectedDirection === '雙向' || d.direction === selectedDirection))
        .map(d => d.lane)
    )).filter(Boolean) as string[];
    return ['全車道', ...lanes];
  }, [constData, selectedRoute, selectedDirection]);

  const availableIriDates = useMemo(() =>
    Array.from(new Set(
      constData.filter(d => d.iri > 0 && (!selectedRoute || selectedRoute === '全轄區' || d.route === selectedRoute)).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a))
  , [constData, selectedRoute]);

  const availableSnDates = useMemo(() =>
    Array.from(new Set(
      constData.filter(d => d.sn > 0 && (!selectedRoute || selectedRoute === '全轄區' || d.route === selectedRoute)).map(d => d.date)
    )).sort((a, b) => b.localeCompare(a))
  , [constData, selectedRoute]);

  // ── 自動初始化選項
  React.useEffect(() => {
    if (routes.length > 0 && !routes.includes(selectedRoute)) {
      const actualRoutes = routes.filter(r => r !== '全轄區');
      setSelectedRoute(actualRoutes.length > 0 ? actualRoutes[0] : routes[0]);
    }
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

  // ── 依 方向 + 車道 分別計算施工區段群（各方向各車道施工里程獨立限制，支援跳區域）
  const dirLaneSegmentsMap = useMemo<Record<string, Record<string, ConstructionSegment[]>>>(() => {
    if (!selectedRoute || constData.length === 0) return {};
    const isAllDistrict = selectedRoute === '全轄區';
    const GAP_THRESHOLD = 0.3; // 300 公尺以上差距視為跳區

    // 依 方向 -> 車道 歸類實際施工里程
    const grouped: Record<string, Record<string, number[]>> = {};
    const filtered = constData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection)
    );

    filtered.forEach(d => {
      if (!grouped[d.direction]) grouped[d.direction] = {};
      if (!grouped[d.direction][d.lane]) grouped[d.direction][d.lane] = [];
      grouped[d.direction][d.lane].push(Number(d.mileage.toFixed(3)));
    });

    const result: Record<string, Record<string, ConstructionSegment[]>> = {};

    Object.entries(grouped).forEach(([dir, laneMap]) => {
      result[dir] = {};
      Object.entries(laneMap).forEach(([lane, mileages]) => {
        const ms = Array.from(new Set(mileages)).sort((a, b) => a - b);
        if (ms.length === 0) return;

        const segs: ConstructionSegment[] = [];
        let curStart = ms[0];
        let curEnd = ms[0];

        for (let i = 1; i < ms.length; i++) {
          const m = ms[i];
          if (m - curEnd <= GAP_THRESHOLD) {
            curEnd = m;
          } else {
            segs.push({ start: curStart, end: curEnd });
            curStart = m;
            curEnd = m;
          }
        }
        segs.push({ start: curStart, end: curEnd });
        result[dir][lane] = segs;
      });
    });

    return result;
  }, [constData, selectedRoute, selectedDirection]);

  // 區間合併工具（用於多方向/多車道施工區間聯集）
  const mergeIntervals = (segments: ConstructionSegment[], gapThreshold = 0.3): ConstructionSegment[] => {
    if (segments.length === 0) return [];
    const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
    const result: ConstructionSegment[] = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const last = result[result.length - 1];

      if (cur.start <= last.end + gapThreshold) {
        last.end = Math.max(last.end, cur.end);
      } else {
        result.push({ ...cur });
      }
    }
    return result;
  };

  // ── 當前篩選條件對應的施工區段群（方向 + 車道）
  const constSegments = useMemo<ConstructionSegment[]>(() => {
    if (Object.keys(dirLaneSegmentsMap).length === 0) return [];

    const dirs = selectedDirection !== '雙向'
      ? (dirLaneSegmentsMap[selectedDirection] ? [selectedDirection] : [])
      : Object.keys(dirLaneSegmentsMap);

    if (dirs.length === 0) return [];

    const segmentsToMerge: ConstructionSegment[] = [];

    dirs.forEach(dir => {
      const laneMap = dirLaneSegmentsMap[dir] || {};
      if (selectedLane !== '全車道' && selectedLane !== MERGED_LANE_KEY) {
        if (laneMap[selectedLane]) segmentsToMerge.push(...laneMap[selectedLane]);
      } else if (selectedLane === MERGED_LANE_KEY) {
        if (laneMap['第二車道']) segmentsToMerge.push(...laneMap['第二車道']);
        if (laneMap['第三車道']) segmentsToMerge.push(...laneMap['第三車道']);
      } else {
        Object.values(laneMap).forEach(segs => segmentsToMerge.push(...segs));
      }
    });

    return mergeIntervals(segmentsToMerge);
  }, [dirLaneSegmentsMap, selectedDirection, selectedLane, MERGED_LANE_KEY]);

  // 判斷某里程、方向與車道是否落在施工區段內（前後加 0.05km 容許誤差）
  // 嚴格依據該方向該車道自身施工區段判定；若未施工直接返回 false
  const isInConstArea = (mileage: number, direction?: string, lane?: string, tolerance = 0.05): boolean => {
    if (direction && lane) {
      const dirMap = dirLaneSegmentsMap[direction];
      if (!dirMap) return false;
      const segs = dirMap[lane];
      if (!segs || segs.length === 0) return false;
      return segs.some(seg => mileage >= seg.start - tolerance && mileage <= seg.end + tolerance);
    }

    if (constSegments.length === 0) return false;
    return constSegments.some(seg => mileage >= seg.start - tolerance && mileage <= seg.end + tolerance);
  };

  // ── 測點 1-to-1 配對機制：保證施工前與施工後「有效點數嚴格相符」且里程位置一一成對
  const matchPairs = (
    constPoints: PavementData[],
    dbCandidates: PavementData[],
    maxDiff = 0.05
  ): { pairedConst: PavementData[]; pairedDb: PavementData[] } => {
    const pairedConst: PavementData[] = [];
    const pairedDb: PavementData[] = [];
    const usedDbIndices = new Set<number>();

    // 依 direction__lane 分組資料庫測點以提高匹配效能
    const dbGrouped: Record<string, { item: PavementData; index: number }[]> = {};
    dbCandidates.forEach((d, idx) => {
      const key = `${d.direction}__${d.lane}`;
      if (!dbGrouped[key]) dbGrouped[key] = [];
      dbGrouped[key].push({ item: d, index: idx });
    });

    for (const cp of constPoints) {
      const key = `${cp.direction}__${cp.lane}`;
      const list = dbGrouped[key];
      if (!list || list.length === 0) continue;

      let bestMatch: { item: PavementData; index: number } | null = null;
      let bestDist = Infinity;

      for (const candidate of list) {
        if (usedDbIndices.has(candidate.index)) continue;
        const dist = Math.abs(candidate.item.mileage - cp.mileage);
        if (dist <= maxDiff && dist < bestDist) {
          bestDist = dist;
          bestMatch = candidate;
        }
      }

      if (bestMatch) {
        usedDbIndices.add(bestMatch.index);
        pairedConst.push(cp);
        pairedDb.push({
          ...bestMatch.item,
          mileage: cp.mileage, // 里程對齊施工後測點，使走勢圖疊合與分析無雜訊
        });
      }
    }

    return { pairedConst, pairedDb };
  };

  // 施工里程極值（供圖表邊界參考）
  const constMileageRange = useMemo(() => {
    if (constSegments.length === 0) return null;
    return {
      min: constSegments[0].start,
      max: constSegments[constSegments.length - 1].end,
      segments: constSegments,
    };
  }, [constSegments]);

  // 格式化施工區間文字（例如：178.000k ~ 179.000k）
  const formatSegmentsText = (segments: ConstructionSegment[]): string => {
    if (segments.length === 0) return '無里程資料';
    if (segments.length === 1) {
      return `${segments[0].start.toFixed(3)}k ~ ${segments[0].end.toFixed(3)}k`;
    }
    return segments.map(s => `${s.start.toFixed(3)}k ~ ${s.end.toFixed(3)}k`).join('、') + ` (共 ${segments.length} 處施工區段)`;
  };

  // ── 資料庫比對可用日期（嚴格限制落在各方向各車道自身施工區段內，跳區或未施工方向/車道不比對）
  const availableDbIriDates = useMemo(() => {
    if (!compareMode || !selectedRoute || constSegments.length === 0) return [];
    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (l: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return l === '第二車道' || l === '第三車道';
      return l === selectedLane;
    };
    return Array.from(new Set(
      dbData
        .filter(d =>
          (isAllDistrict || d.route === selectedRoute) &&
          (selectedDirection === '雙向' || d.direction === selectedDirection) &&
          laneFilter(d.lane) &&
          d.iri > 0 &&
          isInConstArea(d.mileage, d.direction, d.lane)
        )
        .map(d => d.date)
    )).sort((a, b) => b.localeCompare(a));
  }, [compareMode, selectedRoute, selectedDirection, selectedLane, constSegments, dirLaneSegmentsMap, dbData, MERGED_LANE_KEY]);

  const availableDbSnDates = useMemo(() => {
    if (!compareMode || !selectedRoute || constSegments.length === 0) return [];
    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (l: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return l === '第二車道' || l === '第三車道';
      return l === selectedLane;
    };
    return Array.from(new Set(
      dbData
        .filter(d =>
          (isAllDistrict || d.route === selectedRoute) &&
          (selectedDirection === '雙向' || d.direction === selectedDirection) &&
          laneFilter(d.lane) &&
          d.sn > 0 &&
          isInConstArea(d.mileage, d.direction, d.lane)
        )
        .map(d => d.date)
    )).sort((a, b) => b.localeCompare(a));
  }, [compareMode, selectedRoute, selectedDirection, selectedLane, constSegments, dirLaneSegmentsMap, dbData, MERGED_LANE_KEY]);

  // 自動設定預設的比對日期（優先選施工日期前最近一期）
  React.useEffect(() => {
    if (availableDbIriDates.length > 0) {
      if (!selectedDbIriDate || !availableDbIriDates.includes(selectedDbIriDate)) {
        const earlier = availableDbIriDates.filter(d => !selectedIriDate || d < selectedIriDate);
        setSelectedDbIriDate(earlier.length > 0 ? earlier[0] : availableDbIriDates[0]);
      }
    } else {
      setSelectedDbIriDate('');
    }
  }, [availableDbIriDates, selectedIriDate]);

  React.useEffect(() => {
    if (availableDbSnDates.length > 0) {
      if (!selectedDbSnDate || !availableDbSnDates.includes(selectedDbSnDate)) {
        const earlier = availableDbSnDates.filter(d => !selectedSnDate || d < selectedSnDate);
        setSelectedDbSnDate(earlier.length > 0 ? earlier[0] : availableDbSnDates[0]);
      }
    } else {
      setSelectedDbSnDate('');
    }
  }, [availableDbSnDates, selectedSnDate]);

  // ── 免測判定與過濾
  const isExempt = (d: PavementData, zones: ExemptZone[]): boolean => {
    return zones.some(z => {
      if (z.route !== d.route) return false;
      if (z.direction && z.direction !== d.direction) return false;
      if (z.type === 'point') {
        const target = z.mileage ?? -Infinity;
        return Math.abs(d.mileage - target) <= 0.01;
      }
      const s = Math.min(z.start ?? Infinity, z.end ?? -Infinity);
      const e = Math.max(z.start ?? Infinity, z.end ?? -Infinity);
      return d.mileage >= s && d.mileage <= e;
    });
  };

  const applyExempt = (items: PavementData[], zones: ExemptZone[]): PavementData[] => {
    if (currentIriExemptMode === 'all' || zones.length === 0) return items;
    if (currentIriExemptMode === 'exclude') return items.filter(d => !isExempt(d, zones));
    return items.filter(d => {
      if (!isExempt(d, zones)) return true;
      return d.iri <= 1.75;
    });
  };

  // ── 統計數據（施工後 vs 施工前比對）
  // ── 統計數據（施工後 vs 施工前比對，保證有效點數相符）
  const stats = useMemo(() => {
    if (constData.length === 0 || !selectedRoute) return null;

    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (lane: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return lane === '第二車道' || lane === '第三車道';
      return lane === selectedLane;
    };
    const baseFilter = (d: PavementData) =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection);

    const activeZones = isAllDistrict
      ? exemptZones
      : exemptZones.filter(z => z.route === selectedRoute);

    // ── 施工後原始與免測過濾資料
    const rawConstIri = selectedIriDate
      ? constData.filter(d => baseFilter(d) && d.iri > 0 && d.date === selectedIriDate && laneFilter(d.lane))
      : [];
    const validConstIri = applyExempt(rawConstIri, activeZones);
    const constExemptedCount = rawConstIri.length - validConstIri.length;

    const constSnData = selectedSnDate
      ? constData.filter(d => baseFilter(d) && d.sn > 0 && d.date === selectedSnDate && laneFilter(d.lane))
      : [];

    let evalConstIri = validConstIri;
    let evalDbIri: PavementData[] = [];
    let evalConstSn = constSnData;
    let evalDbSn: PavementData[] = [];
    let dbTotalRaw = 0;
    let dbExemptedCount = 0;

    // ── 施工前（資料庫）對比資料配對
    if (compareMode && constSegments.length > 0) {
      if (selectedDbIriDate) {
        const rawDbIri = dbData.filter(d =>
          baseFilter(d) &&
          d.iri > 0 &&
          d.date === selectedDbIriDate &&
          laneFilter(d.lane) &&
          isInConstArea(d.mileage, d.direction, d.lane)
        );
        dbTotalRaw = rawDbIri.length;
        const validDbIri = applyExempt(rawDbIri, activeZones);
        dbExemptedCount = rawDbIri.length - validDbIri.length;

        // 進行 1 對 1 測點配對，使有效點數完全相符
        const paired = matchPairs(validConstIri, validDbIri, 0.05);
        evalConstIri = paired.pairedConst;
        evalDbIri = paired.pairedDb;
      }

      if (selectedDbSnDate) {
        const rawDbSn = dbData.filter(d =>
          baseFilter(d) &&
          d.sn > 0 &&
          d.date === selectedDbSnDate &&
          laneFilter(d.lane) &&
          isInConstArea(d.mileage, d.direction, d.lane)
        );
        const pairedSn = matchPairs(constSnData, rawDbSn, 0.05);
        evalConstSn = pairedSn.pairedConst;
        evalDbSn = pairedSn.pairedDb;
      }
    }

    const constN = evalConstIri.length;
    const constAvgIri = constN > 0 ? evalConstIri.reduce((a, d) => a + d.iri, 0) / constN : 0;
    const constAvgSn = evalConstSn.length > 0 ? evalConstSn.reduce((a, d) => a + d.sn, 0) / evalConstSn.length : 0;
    const constIriB1 = evalConstIri.filter(d => d.iri >= 1.75 && d.iri < 2.0).length;
    const constIriB2 = evalConstIri.filter(d => d.iri >= 2.0 && d.iri < 2.5).length;
    const constIriB3 = evalConstIri.filter(d => d.iri >= 2.5).length;
    const pct = (c: number, total: number) => (total > 0 ? (c / total * 100).toFixed(1) : '0.0');
    const constCountSn35 = evalConstSn.filter(d => d.sn > 0 && d.sn < 35).length;

    // 施工前統計（與施工後成對點位相符）
    const dbIriCount = evalDbIri.length;
    const dbSnCount = evalDbSn.length;
    const dbAvgIri = dbIriCount > 0 ? evalDbIri.reduce((a, d) => a + d.iri, 0) / dbIriCount : 0;
    const dbAvgSn = dbSnCount > 0 ? evalDbSn.reduce((a, d) => a + d.sn, 0) / dbSnCount : 0;
    const dbIriB1 = evalDbIri.filter(d => d.iri >= 1.75 && d.iri < 2.0).length;
    const dbIriB2 = evalDbIri.filter(d => d.iri >= 2.0 && d.iri < 2.5).length;
    const dbIriB3 = evalDbIri.filter(d => d.iri >= 2.5).length;
    const dbCountSn35 = evalDbSn.filter(d => d.sn > 0 && d.sn < 35).length;

    const improvement = dbAvgIri > 0 && constAvgIri > 0 ? (dbAvgIri - constAvgIri).toFixed(2) : null;
    const iriImprovePct = dbAvgIri > 0 && constAvgIri > 0 ? ((dbAvgIri - constAvgIri) / dbAvgIri * 100).toFixed(1) : null;
    const snDiff = dbAvgSn > 0 && constAvgSn > 0 ? (constAvgSn - dbAvgSn).toFixed(1) : null;
    const badBefore = dbIriB1 + dbIriB2 + dbIriB3;
    const badAfter = constIriB1 + constIriB2 + constIriB3;
    const badDiff = badBefore - badAfter;

    return {
      constAvgIri: constAvgIri.toFixed(2),
      constAvgSn: constAvgSn.toFixed(1),
      constIriCount: constN,
      constSnCount: evalConstSn.length,
      constTotalRaw: rawConstIri.length,
      constExemptedCount,
      constIriBands: [
        { label: '1.75 ≤ IRI < 2.0', count: constIriB1, pct: pct(constIriB1, constN), color: 'text-yellow-600' },
        { label: '2.0 ≤ IRI < 2.5',  count: constIriB2, pct: pct(constIriB2, constN), color: 'text-orange-600' },
        { label: 'IRI ≥ 2.5',        count: constIriB3, pct: pct(constIriB3, constN), color: 'text-red-600'    },
      ],
      constCountSn35,

      // 資料庫對比（點數與施工後成對相符）
      dbAvgIri: dbAvgIri > 0 ? dbAvgIri.toFixed(2) : null,
      dbAvgSn: dbAvgSn > 0 ? dbAvgSn.toFixed(1) : null,
      dbIriDate: selectedDbIriDate,
      dbSnDate: selectedDbSnDate,
      dbIriCount,
      dbSnCount,
      dbTotalRaw,
      dbExemptedCount,
      dbIriBands: [
        { label: '1.75 ≤ IRI < 2.0', count: dbIriB1, pct: pct(dbIriB1, dbIriCount), color: 'text-yellow-600' },
        { label: '2.0 ≤ IRI < 2.5',  count: dbIriB2, pct: pct(dbIriB2, dbIriCount), color: 'text-orange-600' },
        { label: 'IRI ≥ 2.5',        count: dbIriB3, pct: pct(dbIriB3, dbIriCount), color: 'text-red-600'    },
      ],
      dbCountSn35,

      // 改善成效
      improvement,
      iriImprovePct,
      snDiff,
      badDiff,
      badBefore,
      badAfter,
    };
  }, [
    constData, selectedRoute, selectedDirection, selectedLane, selectedIriDate, selectedSnDate,
    compareMode, dbData, constSegments, dirLaneSegmentsMap, selectedDbIriDate, selectedDbSnDate,
    exemptZones, currentIriExemptMode, MERGED_LANE_KEY
  ]);

  // ── 對比圖表資料：施工後與資料庫施工前成對合併繪製（點對點相符，跳區或未施工方向/車道不顯示）
  const combinedIriData = useMemo(() => {
    if (!compareMode || !selectedDbIriDate || constSegments.length === 0) return [];
    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (l: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return l === '第二車道' || l === '第三車道';
      return l === selectedLane;
    };

    const constFiltered = constData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      d.iri > 0 &&
      d.date === selectedIriDate
    );

    const dbFiltered = dbData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      d.iri > 0 &&
      d.date === selectedDbIriDate &&
      isInConstArea(d.mileage, d.direction, d.lane)
    );

    const { pairedConst, pairedDb } = matchPairs(constFiltered, dbFiltered, 0.05);

    const constPts = pairedConst.map(d => ({ ...d, date: `${selectedIriDate} (施工後)` }));
    const dbPts = pairedDb.map(d => ({ ...d, date: `${selectedDbIriDate} (施工前)` }));

    return [...dbPts, ...constPts];
  }, [compareMode, selectedDbIriDate, constSegments, dirLaneSegmentsMap, selectedRoute, selectedDirection, selectedLane, selectedIriDate, dbData, constData, MERGED_LANE_KEY]);

  const combinedSnData = useMemo(() => {
    if (!compareMode || !selectedDbSnDate || constSegments.length === 0) return [];
    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (l: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return l === '第二車道' || l === '第三車道';
      return l === selectedLane;
    };

    const constFiltered = constData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      d.sn > 0 &&
      d.date === selectedSnDate
    );

    const dbFiltered = dbData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      d.sn > 0 &&
      d.date === selectedDbSnDate &&
      isInConstArea(d.mileage, d.direction, d.lane)
    );

    const { pairedConst, pairedDb } = matchPairs(constFiltered, dbFiltered, 0.05);

    const constPts = pairedConst.map(d => ({ ...d, date: `${selectedSnDate} (施工後)` }));
    const dbPts = pairedDb.map(d => ({ ...d, date: `${selectedDbSnDate} (施工前)` }));

    return [...dbPts, ...constPts];
  }, [compareMode, selectedDbSnDate, constSegments, dirLaneSegmentsMap, selectedRoute, selectedDirection, selectedLane, selectedSnDate, dbData, constData, MERGED_LANE_KEY]);

  // 單獨的施工前資料（與施工後點位成對配對）
  const singleDbData = useMemo(() => {
    if (!compareMode || constSegments.length === 0) return [];
    const isAllDistrict = selectedRoute === '全轄區';
    const laneFilter = (l: string) => {
      if (selectedLane === '全車道') return true;
      if (selectedLane === MERGED_LANE_KEY) return l === '第二車道' || l === '第三車道';
      return l === selectedLane;
    };

    const constFiltered = constData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      ((d.iri > 0 && d.date === selectedIriDate) || (d.sn > 0 && d.date === selectedSnDate))
    );

    const dbCandidates = dbData.filter(d =>
      (isAllDistrict || d.route === selectedRoute) &&
      (selectedDirection === '雙向' || d.direction === selectedDirection) &&
      laneFilter(d.lane) &&
      isInConstArea(d.mileage, d.direction, d.lane) &&
      (d.date === selectedDbIriDate || d.date === selectedDbSnDate)
    );

    const { pairedDb } = matchPairs(constFiltered, dbCandidates, 0.05);
    return pairedDb;
  }, [compareMode, constSegments, selectedRoute, selectedDirection, selectedLane, dbData, selectedDbIriDate, selectedDbSnDate, dirLaneSegmentsMap, MERGED_LANE_KEY, constData, selectedIriDate, selectedSnDate]);

  // ── 上傳處理
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

  const clearAll = () => {
    setConstData([]);
    setFileRecords([]);
    setSelectedRoute('');
    sessionStorage.removeItem('_const_data');
    sessionStorage.removeItem('_const_records');
  };

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
              支援前後對比疊加資料庫歷史資料，並套用 IRI 免測排除規則。<br />
              <span className="text-orange-500 font-semibold mt-1 block">⚠ 此模式資料暫存於瀏覽器分頁中，關閉瀏覽器後自動清除。</span>
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
          施工品質暫存中 — 共 {constData.length} 筆資料（關閉瀏覽器才清除）
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
              compareMode ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'
            }`}>
            <GitCompare className="w-3 h-3" />
            {compareMode ? '前後對比 ON' : '開啟前後對比'}
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

      {/* ── 篩選器 */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
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

        {/* ── 對比模式下的資料庫比對日期設定 */}
        {compareMode && (
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-indigo-900">
                  前後對比比對資料設定 — 施工里程範圍：{formatSegmentsText(constSegments)}
                </span>
              </div>
              <span className="text-[11px] text-indigo-600 font-medium bg-indigo-100/70 px-2.5 py-0.5 rounded-full">
                資料庫資料已自動限制於施工區間內（跳區不顯示）
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 資料庫比對 IRI 日期
                </label>
                <select value={selectedDbIriDate} onChange={e => setSelectedDbIriDate(e.target.value)}
                  className="w-full border border-indigo-200 bg-white rounded-lg py-1.5 px-3 text-xs font-bold text-indigo-800 outline-none appearance-none cursor-pointer"
                  style={SELECT_STYLE}>
                  {availableDbIriDates.length > 0
                    ? availableDbIriDates.map(d => <option key={d} value={d}>{d} {d < selectedIriDate ? '(施工前)' : ''}</option>)
                    : <option value="">無比對資料</option>}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 資料庫比對 SN 日期
                </label>
                <select value={selectedDbSnDate} onChange={e => setSelectedDbSnDate(e.target.value)}
                  className="w-full border border-indigo-200 bg-white rounded-lg py-1.5 px-3 text-xs font-bold text-indigo-800 outline-none appearance-none cursor-pointer"
                  style={SELECT_STYLE}>
                  {availableDbSnDates.length > 0
                    ? availableDbSnDates.map(d => <option key={d} value={d}>{d} {d < selectedSnDate ? '(施工前)' : ''}</option>)
                    : <option value="">無比對資料</option>}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── IRI 免測統計模式切換（常駐顯示） */}
      <div className="flex items-center gap-2 flex-wrap bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
          IRI 免測統計模式：
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            { mode: 'all' as IriExemptMode, label: '全採納', id: 'const-btn-mode-all', color: 'bg-slate-700' },
            { mode: 'exclude' as IriExemptMode, label: '扣除免測', id: 'const-btn-mode-exclude', color: 'bg-amber-600' },
            { mode: 'low-accept' as IriExemptMode, label: '免測但 ≤1.75 仍採納', id: 'const-btn-mode-low-accept', color: 'bg-blue-600' },
          ]).map(({ mode, label, id, color }) => (
            <button
              key={mode}
              id={id}
              onClick={() => handleModeChange(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentIriExemptMode === mode
                  ? `${color} text-white shadow-sm ring-2 ring-offset-1 ring-slate-400`
                  : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {onNavigateToExemptZones && (
          <button
            type="button"
            onClick={onNavigateToExemptZones}
            className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            title="前往專屬分頁維護免測路段資料庫"
          >
            <span>前往維護免測路段 ({exemptZones.length})</span>
            <span>→</span>
          </button>
        )}
      </div>

      {/* ── 免測扣除提示 */}
      {stats && currentIriExemptMode !== 'all' && (stats.constExemptedCount > 0 || (compareMode && stats.dbExemptedCount > 0)) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            目前依<strong>「{currentIriExemptMode === 'exclude' ? '扣除免測' : '免測但 ≤1.75 仍採納'}」</strong>模式：
            施工後排除 <strong>{stats.constExemptedCount}</strong> 處免測點（原始 {stats.constTotalRaw} 處，成對有效 <strong>{stats.constIriCount}</strong> 處）
            {compareMode && stats.dbIriCount > 0 && (
              <>；資料庫比對資料排除 <strong>{stats.dbExemptedCount}</strong> 處免測點（原始 {stats.dbTotalRaw} 處，成對有效 <strong>{stats.dbIriCount}</strong> 處）</>
            )}
            。前後比對有效點數嚴格相符，各級距與平均 IRI 皆依成對測點計算。
          </span>
        </div>
      )}

      {/* ── 統計卡片與對比 */}
      {stats && (
        <div className="space-y-3">
          {/* 前後對比成效橫幅 */}
          {compareMode && stats.dbAvgIri && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-indigo-600 shrink-0" />
                <h4 className="text-sm font-bold text-indigo-950">施工前後品質改善成效總覽</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {/* IRI 改善成效 */}
                <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                  <span className="text-xs text-slate-500 font-medium">平均 IRI 改善幅度</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-xl font-extrabold text-slate-800">{stats.constAvgIri}</span>
                    <span className="text-xs text-slate-400">前: {stats.dbAvgIri}</span>
                  </div>
                  <div className="mt-2">
                    {stats.improvement !== null && (
                      Number(stats.improvement) > 0
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 font-bold rounded-md text-xs"><ArrowDown className="w-3 h-3" /> 改善 {stats.improvement} ({stats.iriImprovePct}%)</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 font-bold rounded-md text-xs"><ArrowUp className="w-3 h-3" /> 上升 {Math.abs(Number(stats.improvement))}</span>
                    )}
                  </div>
                </div>

                {/* 不良路段 (IRI ≥ 1.75) 減少量 */}
                <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                  <span className="text-xs text-slate-500 font-medium">不良路段 (IRI ≥ 1.75)</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-xl font-extrabold text-slate-800">{stats.badAfter} 處</span>
                    <span className="text-xs text-slate-400">前: {stats.badBefore} 處</span>
                  </div>
                  <div className="mt-2">
                    {stats.badDiff > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 font-bold rounded-md text-xs">
                        <ArrowDown className="w-3 h-3" /> 減少 {stats.badDiff} 處
                      </span>
                    ) : stats.badDiff === 0 ? (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-medium rounded-md text-xs">無變化</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 font-bold rounded-md text-xs">
                        <ArrowUp className="w-3 h-3" /> 增加 {Math.abs(stats.badDiff)} 處
                      </span>
                    )}
                  </div>
                </div>

                {/* 抗滑 SN 提升幅度 */}
                <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                  <span className="text-xs text-slate-500 font-medium">平均 SN 抗滑值</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-xl font-extrabold text-slate-800">{stats.constAvgSn || '--'}</span>
                    <span className="text-xs text-slate-400">前: {stats.dbAvgSn || '--'}</span>
                  </div>
                  <div className="mt-2">
                    {stats.snDiff !== null ? (
                      Number(stats.snDiff) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 font-bold rounded-md text-xs">
                          <ArrowUp className="w-3 h-3" /> 提升 {stats.snDiff}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 font-bold rounded-md text-xs">
                          <ArrowDown className="w-3 h-3" /> 變化 {stats.snDiff}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-slate-400">無 SN 比對資料</span>
                    )}
                  </div>
                </div>

                {/* 施工里程範圍 */}
                <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                  <span className="text-xs text-slate-500 font-medium">
                    檢測點數與比對範圍 ({selectedDirection !== '雙向' ? selectedDirection : ''}{selectedLane !== '全車道' ? selectedLane : '全車道'})
                  </span>
                  <div className="mt-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-bold text-slate-700">
                        {compareMode ? `成對有效點: 後 ${stats.constIriCount} 點 / 前 ${stats.dbIriCount} 點` : `有效點數: ${stats.constIriCount} 點`}
                      </p>
                      {compareMode && stats.constIriCount === stats.dbIriCount && (
                        <span className="text-[10px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 font-bold rounded">
                          前後相符
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={formatSegmentsText(constSegments)}>
                      {formatSegmentsText(constSegments)}
                    </p>
                  </div>
                  <div className="mt-2">
                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-medium rounded-md text-xs">
                      比對期別: {stats.dbIriDate || '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 施工前 vs 施工後 詳細統計對照卡 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-500" />
                品質檢測統計數據 {compareMode ? '（施工前 vs 施工後 對照）' : '（施工後檢測）'}
              </span>
              <span className="text-[11px] text-slate-400">
                {currentIriExemptMode === 'all' ? '全部採納' : currentIriExemptMode === 'exclude' ? '扣除免測' : '免測≤1.75仍採納'}
              </span>
            </div>

            <div className="p-4 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3 font-semibold">項目</th>
                    {compareMode && (
                      <th className="py-2.5 px-3 font-semibold text-indigo-700 bg-indigo-50/50">
                        施工前 (資料庫 {stats.dbIriDate || '--'})
                      </th>
                    )}
                    <th className="py-2.5 px-3 font-semibold text-orange-700 bg-orange-50/50">
                      施工後 ({selectedIriDate || '--'})
                    </th>
                    {compareMode && <th className="py-2.5 px-3 font-semibold">前後改善成效</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {/* 平均 IRI */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-bold text-slate-800">平均 IRI (m/km)</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold text-indigo-800 bg-indigo-50/20">
                        {stats.dbAvgIri || '--'}
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-bold text-orange-700 bg-orange-50/20">
                      {stats.constAvgIri}
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold">
                        {stats.improvement !== null ? (
                          Number(stats.improvement) > 0
                            ? <span className="text-green-600">↓ 改善 {stats.improvement} ({stats.iriImprovePct}%)</span>
                            : <span className="text-red-500">↑ 上升 {Math.abs(Number(stats.improvement))}</span>
                        ) : '--'}
                      </td>
                    )}
                  </tr>

                  {/* 1.75 ≤ IRI < 2.0 */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-yellow-600 font-semibold">1.75 ≤ IRI &lt; 2.0 (輕度不平)</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 bg-indigo-50/20">
                        {stats.dbIriBands[0].count} 處 ({stats.dbIriBands[0].pct}%)
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-semibold text-slate-800 bg-orange-50/20">
                      {stats.constIriBands[0].count} 處 ({stats.constIriBands[0].pct}%)
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3">
                        {stats.dbIriBands[0].count - stats.constIriBands[0].count > 0 ? (
                          <span className="text-green-600">↓ 減少 {stats.dbIriBands[0].count - stats.constIriBands[0].count} 處</span>
                        ) : stats.dbIriBands[0].count === stats.constIriBands[0].count ? (
                          <span className="text-slate-400">持平</span>
                        ) : (
                          <span className="text-amber-600">↑ 增加 {stats.constIriBands[0].count - stats.dbIriBands[0].count} 處</span>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* 2.0 ≤ IRI < 2.5 */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-orange-600 font-semibold">2.0 ≤ IRI &lt; 2.5 (中度不平)</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 bg-indigo-50/20">
                        {stats.dbIriBands[1].count} 處 ({stats.dbIriBands[1].pct}%)
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-semibold text-slate-800 bg-orange-50/20">
                      {stats.constIriBands[1].count} 處 ({stats.constIriBands[1].pct}%)
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3">
                        {stats.dbIriBands[1].count - stats.constIriBands[1].count > 0 ? (
                          <span className="text-green-600 font-bold">↓ 減少 {stats.dbIriBands[1].count - stats.constIriBands[1].count} 處</span>
                        ) : stats.dbIriBands[1].count === stats.constIriBands[1].count ? (
                          <span className="text-slate-400">持平</span>
                        ) : (
                          <span className="text-red-500 font-bold">↑ 增加 {stats.constIriBands[1].count - stats.dbIriBands[1].count} 處</span>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* IRI ≥ 2.5 */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-red-600 font-bold">IRI ≥ 2.5 (嚴重不良/待改善)</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold text-red-700 bg-indigo-50/20">
                        {stats.dbIriBands[2].count} 處 ({stats.dbIriBands[2].pct}%)
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-bold text-red-700 bg-orange-50/20">
                      {stats.constIriBands[2].count} 處 ({stats.constIriBands[2].pct}%)
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold">
                        {stats.dbIriBands[2].count - stats.constIriBands[2].count > 0 ? (
                          <span className="text-green-600">↓ 減少 {stats.dbIriBands[2].count - stats.constIriBands[2].count} 處</span>
                        ) : stats.dbIriBands[2].count === stats.constIriBands[2].count ? (
                          <span className="text-slate-400">持平</span>
                        ) : (
                          <span className="text-red-500">↑ 增加 {stats.constIriBands[2].count - stats.dbIriBands[2].count} 處</span>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* 平均 SN */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-bold text-purple-700">平均 SN 抗滑值</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold text-indigo-800 bg-indigo-50/20">
                        {stats.dbAvgSn || '--'}
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-bold text-purple-700 bg-orange-50/20">
                      {stats.constAvgSn || '--'}
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3 font-bold">
                        {stats.snDiff !== null ? (
                          Number(stats.snDiff) > 0 ? (
                            <span className="text-green-600">↑ 提升 {stats.snDiff}</span>
                          ) : (
                            <span className="text-amber-600">↓ 變化 {stats.snDiff}</span>
                          )
                        ) : '--'}
                      </td>
                    )}
                  </tr>

                  {/* SN < 35 */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-red-600 font-semibold">SN &lt; 35 (抗滑不足)</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 bg-indigo-50/20">
                        {stats.dbCountSn35} 處
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-semibold text-slate-800 bg-orange-50/20">
                      {stats.constCountSn35} 處
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3">
                        {stats.dbCountSn35 - stats.constCountSn35 > 0 ? (
                          <span className="text-green-600 font-bold">↓ 減少 {stats.dbCountSn35 - stats.constCountSn35} 處</span>
                        ) : stats.dbCountSn35 === stats.constCountSn35 ? (
                          <span className="text-slate-400">持平</span>
                        ) : (
                          <span className="text-red-500 font-bold">↑ 增加 {stats.constCountSn35 - stats.dbCountSn35} 處</span>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* 有效測點數 */}
                  <tr className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-slate-500">有效測點數 / 免測排除</td>
                    {compareMode && (
                      <td className="py-2.5 px-3 text-slate-500 bg-indigo-50/20">
                        {stats.dbIriCount} 點 (排除 {stats.dbExemptedCount} 點)
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-slate-500 bg-orange-50/20">
                      {stats.constIriCount} 點 (排除 {stats.constExemptedCount} 點)
                    </td>
                    {compareMode && (
                      <td className="py-2.5 px-3 text-slate-400">
                        施工里程範圍限制
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 趨勢圖區域 */}
      <div className="space-y-6">
        {selectedRoute === '全轄區' || !selectedRoute ? (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">全轄區模式不顯示個別趨勢圖</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
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
          <div className="space-y-6">
            {/* ── 對比模式下的圖表視角切換器 */}
            {compareMode && (
              <div className="flex items-center justify-between flex-wrap gap-2 bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <GitCompare className="w-4 h-4 text-indigo-600" />
                  前後對比圖表檢視方式：
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setChartViewMode('overlay')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      chartViewMode === 'overlay'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    雙線疊合對比圖 (推薦)
                  </button>
                  <button
                    onClick={() => setChartViewMode('split')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      chartViewMode === 'split'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    前後分開檢視
                  </button>
                </div>
              </div>
            )}

            {/* ── 情況 A：前後疊合對比圖 */}
            {compareMode && chartViewMode === 'overlay' ? (
              <div className="space-y-5">
                {/* IRI 疊合對比走勢圖 */}
                {selectedLane !== MERGED_LANE_KEY && (
                  <div className="rounded-2xl overflow-hidden ring-2 ring-indigo-400 shadow-sm">
                    <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <GitCompare className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-bold text-indigo-900">
                          【前後疊合對比】{selectedRoute} {selectedDirection} {selectedLane} — IRI 里程走勢圖
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
                          施工前 ({selectedDbIriDate || '無比對'})
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                          施工後 ({selectedIriDate || '--'})
                        </span>
                      </div>
                    </div>
                    <div className="bg-white p-4">
                      {combinedIriData.length > 0 ? (
                        <MileageTrendChart
                          data={combinedIriData}
                          route={selectedRoute}
                          direction={selectedDirection}
                          lane={selectedLane}
                          mergedLaneKey={MERGED_LANE_KEY}
                          type="iri"
                          exemptZones={exemptZones}
                        />
                      ) : (
                        <div className="text-center text-slate-400 py-8 text-xs">無重疊之 IRI 檢測資料</div>
                      )}
                    </div>
                  </div>
                )}

                {/* PRQI 施工後走勢圖 */}
                {selectedLane !== MERGED_LANE_KEY && (
                  <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                    <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-slate-600" />
                      <span className="text-xs font-bold text-slate-700">
                        施工後 PRQI 走勢圖 — {selectedRoute} {selectedDirection} {selectedLane}
                      </span>
                    </div>
                    <div className="bg-white p-4">
                      <MileageTrendChart
                        data={constData}
                        route={selectedRoute}
                        direction={selectedDirection}
                        lane={selectedLane}
                        mergedLaneKey={MERGED_LANE_KEY}
                        type="prqi"
                        exemptZones={[]}
                      />
                    </div>
                  </div>
                )}

                {/* SN 疊合對比走勢圖 */}
                <div className="rounded-2xl overflow-hidden ring-2 ring-purple-400 shadow-sm">
                  <div className="bg-purple-50 border-b border-purple-200 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <GitCompare className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-bold text-purple-900">
                        【前後疊合對比】{selectedRoute} {selectedDirection} {selectedLane} — SN 抗滑走勢圖
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
                        施工前 ({selectedDbSnDate || '無比對'})
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block"></span>
                        施工後 ({selectedSnDate || '--'})
                      </span>
                    </div>
                  </div>
                  <div className="bg-white p-4">
                    {combinedSnData.length > 0 ? (
                      <MileageTrendChart
                        data={combinedSnData}
                        route={selectedRoute}
                        direction={selectedDirection}
                        lane={selectedLane}
                        mergedLaneKey={MERGED_LANE_KEY}
                        type="sn"
                        exemptZones={[]}
                      />
                    ) : (
                      <div className="text-center text-slate-400 py-8 text-xs">無重疊之 SN 檢測資料</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ── 情況 B：分別檢視（一般模式 或 分開檢視模式） */
              <div className="space-y-6">
                {/* 施工後（橘色框） */}
                <div className="rounded-2xl overflow-hidden ring-2 ring-orange-300 shadow-sm">
                  <div className="bg-orange-50 border-b border-orange-200 px-4 py-2.5 flex items-center gap-2">
                    <HardHat className="w-4 h-4 text-orange-600" />
                    <span className="text-xs font-bold text-orange-700">
                      施工後（{selectedRoute} {selectedDirection} {selectedLane}）— 暫存資料
                    </span>
                  </div>
                  <div className="bg-white p-4 space-y-4">
                    {selectedLane !== MERGED_LANE_KEY && (
                      <MileageTrendChart
                        data={constData}
                        route={selectedRoute}
                        direction={selectedDirection}
                        lane={selectedLane}
                        mergedLaneKey={MERGED_LANE_KEY}
                        type="iri"
                        exemptZones={exemptZones}
                      />
                    )}
                    {selectedLane !== MERGED_LANE_KEY && (
                      <MileageTrendChart
                        data={constData}
                        route={selectedRoute}
                        direction={selectedDirection}
                        lane={selectedLane}
                        mergedLaneKey={MERGED_LANE_KEY}
                        type="prqi"
                        exemptZones={[]}
                      />
                    )}
                    <MileageTrendChart
                      data={constData}
                      route={selectedRoute}
                      direction={selectedDirection}
                      lane={selectedLane}
                      mergedLaneKey={MERGED_LANE_KEY}
                      type="sn"
                      exemptZones={[]}
                    />
                  </div>
                </div>

                {/* 施工前對比（藍色框） */}
                {compareMode && (
                  <div className="rounded-2xl overflow-hidden ring-2 ring-indigo-300 shadow-sm">
                    <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-2.5 flex items-center gap-2">
                      <GitCompare className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-indigo-700">
                        施工前（資料庫 {selectedDbIriDate || '--'} — {selectedRoute} {selectedDirection} {selectedLane}，限定施工里程範圍）
                      </span>
                    </div>
                    <div className="bg-white p-4 space-y-4">
                      {selectedLane !== MERGED_LANE_KEY && (
                        <MileageTrendChart
                          data={singleDbData}
                          route={selectedRoute}
                          direction={selectedDirection}
                          lane={selectedLane}
                          mergedLaneKey={MERGED_LANE_KEY}
                          type="iri"
                          exemptZones={exemptZones}
                        />
                      )}
                      {selectedLane !== MERGED_LANE_KEY && (
                        <MileageTrendChart
                          data={singleDbData}
                          route={selectedRoute}
                          direction={selectedDirection}
                          lane={selectedLane}
                          mergedLaneKey={MERGED_LANE_KEY}
                          type="prqi"
                          exemptZones={exemptZones}
                        />
                      )}
                      {selectedDbSnDate && (
                        <MileageTrendChart
                          data={singleDbData}
                          route={selectedRoute}
                          direction={selectedDirection}
                          lane={selectedLane}
                          mergedLaneKey={MERGED_LANE_KEY}
                          type="sn"
                          exemptZones={exemptZones}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
