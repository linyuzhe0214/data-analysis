import React, { useMemo, useState, useCallback } from 'react';
import { PavementData } from '../types';
import { cn } from '../lib/utils';

// ── 預設級距 ──────────────────────────────────────────────────────────────────
export interface IriRange {
  label: string;   // 顯示文字
  max: number;     // 上限（最後一個無上限，設 Infinity）
  color: string;   // hex color
}

const DEFAULT_RANGES: IriRange[] = [
  { label: 'IRI ≤ 1.0',          max: 1.0,       color: '#3b82f6' }, // blue-500
  { label: '1.0 < IRI ≤ 1.3',    max: 1.3,       color: '#22c55e' }, // green-500
  { label: '1.3 < IRI ≤ 1.75',   max: 1.75,      color: '#facc15' }, // yellow-400
  { label: '1.75 < IRI ≤ 2.0',   max: 2.0,       color: '#fb923c' }, // orange-400
  { label: '2.0 < IRI ≤ 2.5',    max: 2.5,       color: '#ea580c' }, // orange-600
  { label: 'IRI > 2.5',          max: Infinity,  color: '#dc2626' }, // red-600
];

function getColorForIri(iri: number, ranges: IriRange[]): string {
  for (const r of ranges) {
    if (iri <= r.max) return r.color;
  }
  return ranges[ranges.length - 1]?.color ?? '#dc2626';
}

// ── 自訂面板 ──────────────────────────────────────────────────────────────────
interface CustomRangePanelProps {
  ranges: IriRange[];
  onChange: (ranges: IriRange[]) => void;
  onClose: () => void;
}

const CustomRangePanel: React.FC<CustomRangePanelProps> = ({ ranges, onChange, onClose }) => {
  const [draft, setDraft] = useState<IriRange[]>(
    ranges.map(r => ({ ...r, max: r.max === Infinity ? (999 as number) : r.max }))
  );

  const update = (i: number, field: keyof IriRange, value: string) => {
    setDraft(prev => {
      const next = prev.map((r, idx) => idx === i ? { ...r, [field]: field === 'max' ? parseFloat(value) || 0 : value } : r);
      return next;
    });
  };

  const addRow = () => {
    setDraft(prev => {
      const lastMax = prev[prev.length - 1]?.max ?? 2.5;
      const newMax = isFinite(lastMax) ? lastMax + 0.5 : 999;
      return [...prev, { label: `IRI > ${prev[prev.length - 1]?.max ?? 2.5}`, max: newMax, color: '#6b7280' }];
    });
  };

  const removeRow = (i: number) => {
    setDraft(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  };

  const apply = () => {
    const sorted = [...draft].sort((a, b) => a.max - b.max);
    // 最後一筆 max 設成 Infinity
    sorted[sorted.length - 1].max = Infinity;
    onChange(sorted);
    onClose();
  };

  const reset = () => {
    setDraft(DEFAULT_RANGES.map(r => ({ ...r, max: r.max === Infinity ? 999 : r.max })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[480px] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-semibold text-slate-800">自訂義 IRI 級距與顏色</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="space-y-2 mb-4">
          {draft.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              {/* 顏色 */}
              <input
                type="color"
                value={r.color}
                onChange={e => update(i, 'color', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border border-slate-200 p-0.5"
              />
              {/* 標籤 */}
              <input
                type="text"
                value={r.label}
                onChange={e => update(i, 'label', e.target.value)}
                placeholder="標籤"
                className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {/* 上限 */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">上限</span>
                {i === draft.length - 1 ? (
                  <span className="text-xs text-slate-400 w-16 text-center">∞</span>
                ) : (
                  <input
                    type="number"
                    step="0.05"
                    value={r.max}
                    onChange={e => update(i, 'max', e.target.value)}
                    className="w-16 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                )}
              </div>
              {/* 刪除 */}
              <button
                onClick={() => removeRow(i)}
                className="text-red-400 hover:text-red-600 text-sm leading-none px-1"
              >✕</button>
            </div>
          ))}
        </div>

        <button
          onClick={addRow}
          className="w-full text-sm text-blue-500 hover:text-blue-700 border border-dashed border-blue-300 hover:border-blue-500 rounded-lg py-1.5 mb-4 transition-colors"
        >
          + 新增級距
        </button>

        <div className="flex justify-between gap-2">
          <button
            onClick={reset}
            className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg transition-colors"
          >
            還原預設
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-1.5 border border-slate-200 rounded-lg transition-colors">取消</button>
            <button
              onClick={apply}
              className="text-sm text-white bg-blue-500 hover:bg-blue-600 px-4 py-1.5 rounded-lg transition-colors"
            >套用</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 主元件 ────────────────────────────────────────────────────────────────────
interface ColorMapProps {
  data: PavementData[];
  title: string;
}

export const ColorMap: React.FC<ColorMapProps> = ({ data, title }) => {
  const [ranges, setRanges] = useState<IriRange[]>(DEFAULT_RANGES);
  const [hiddenRanges, setHiddenRanges] = useState<Set<number>>(new Set());
  const [showCustomPanel, setShowCustomPanel] = useState(false);

  const toggleRange = useCallback((i: number) => {
    setHiddenRanges(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  const { lanes, minMileage, maxMileage, groupedData, laneMaxMileage } = useMemo(() => {
    const lanesSet = new Set<string>();
    let minM = Infinity;
    let maxM = -Infinity;
    const grouped: Record<string, PavementData[]> = {};
    const laneMax: Record<string, number> = {};

    data.forEach(d => {
      lanesSet.add(d.lane);
      if (d.mileage < minM) minM = d.mileage;
      if (d.mileage > maxM) maxM = d.mileage;
      if (!grouped[d.lane]) grouped[d.lane] = [];
      grouped[d.lane].push(d);
      if (laneMax[d.lane] === undefined || d.mileage > laneMax[d.lane]) {
        laneMax[d.lane] = d.mileage;
      }
    });

    const laneOrder = [
      '內側車道', '第一車道',
      '中線車道', '第二車道',
      '外側車道', '第三車道',
      '第四車道', '第五車道',
    ];
    const sortedLanes = Array.from(lanesSet).sort((a, b) => {
      const idxA = laneOrder.indexOf(a);
      const idxB = laneOrder.indexOf(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    });

    sortedLanes.forEach(lane => {
      grouped[lane].sort((a, b) => a.mileage - b.mileage);
    });

    return {
      lanes: sortedLanes,
      minMileage: minM === Infinity ? 0 : minM,
      maxMileage: maxM === -Infinity ? 0 : maxM,
      groupedData: grouped,
      laneMaxMileage: laneMax,
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="w-full h-32 flex items-center justify-center bg-slate-100 rounded-lg border border-slate-200 text-slate-500">
        無資料 (No Data)
      </div>
    );
  }

  const totalRange = maxMileage - minMileage || 1;

  // 找出某個點屬於哪個 rangeIndex
  const getRangeIndex = (iri: number): number => {
    for (let i = 0; i < ranges.length; i++) {
      if (iri <= ranges[i].max) return i;
    }
    return ranges.length - 1;
  };

  const getSegments = (points: PavementData[]) => {
    return points.map((point, i) => {
      const prev = points[i - 1];
      const next = points[i + 1];

      const leftM = prev
        ? (prev.mileage + point.mileage) / 2
        : point.mileage - (next ? (next.mileage - point.mileage) / 2 : 0.05);

      const rightM = next
        ? (point.mileage + next.mileage) / 2
        : point.mileage + (prev ? (point.mileage - prev.mileage) / 2 : 0.05);

      const leftPct = ((leftM - minMileage) / totalRange) * 100;
      const widthPct = ((rightM - leftM) / totalRange) * 100;
      const rangeIdx = getRangeIndex(point.iri);

      return { point, leftPct, widthPct, rangeIdx };
    });
  };

  return (
    <>
      {showCustomPanel && (
        <CustomRangePanel
          ranges={ranges}
          onChange={setRanges}
          onClose={() => setShowCustomPanel(false)}
        />
      )}

      <div className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-3">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>

          <div className="flex items-center gap-3 flex-wrap">
            {/* 圖例：可點擊切換隱藏 */}
            <div className="flex flex-wrap gap-2 text-sm">
              {ranges.map((r, i) => {
                const hidden = hiddenRanges.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggleRange(i)}
                    title={hidden ? '點擊顯示' : '點擊隱藏'}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all select-none',
                      hidden
                        ? 'opacity-40 border-slate-200 bg-slate-50'
                        : 'opacity-100 border-transparent bg-slate-50 hover:bg-slate-100'
                    )}
                  >
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: hidden ? '#cbd5e1' : r.color }}
                    />
                    <span className={cn('text-slate-600', hidden && 'line-through text-slate-400')}>
                      {r.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 自訂義按鈕 */}
            <button
              onClick={() => setShowCustomPanel(true)}
              className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-lg px-3 py-1 transition-colors whitespace-nowrap"
            >
              ⚙ 自訂義級距
            </button>
          </div>
        </div>

        <div className="relative pt-2 pb-8 flex flex-col gap-1">
          {lanes.map(lane => {
            const laneEndPct = (((laneMaxMileage[lane] ?? maxMileage) - minMileage) / totalRange) * 100;
            return (
              <div key={lane} className="flex items-center gap-2">
                <div className="w-20 text-xs font-medium text-slate-600 text-right shrink-0">
                  {lane}
                </div>
                <div className="flex-1 h-8 relative rounded-sm overflow-hidden">
                  {/* 底色 */}
                  <div
                    className="absolute top-0 left-0 h-full bg-slate-100"
                    style={{ width: `${laneEndPct}%` }}
                  />
                  {getSegments(groupedData[lane]).map(({ point, leftPct, widthPct, rangeIdx }, index) => {
                    if (hiddenRanges.has(rangeIdx)) return null;
                    return (
                      <div
                        key={`${point.mileage}-${index}`}
                        className="absolute top-0 h-full hover:opacity-75 transition-opacity cursor-crosshair"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: getColorForIri(point.iri, ranges),
                        }}
                        title={`里程: ${point.mileage}k\n車道: ${lane}\nIRI: ${point.iri}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Axis Labels */}
          <div className="absolute bottom-0 left-[5.5rem] right-0 h-8 flex justify-between items-end px-1 pointer-events-none">
            {Array.from({ length: 11 }).map((_, i) => {
              const m = minMileage + (maxMileage - minMileage) * (i / 10);
              return (
                <div key={i} className="text-[10px] text-slate-500 flex flex-col items-center">
                  <div className="w-px h-1.5 bg-slate-300 mb-0.5" />
                  {m.toFixed(1)}k
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
