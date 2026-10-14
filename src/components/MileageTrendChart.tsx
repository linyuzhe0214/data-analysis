import React, { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { PavementData } from '../types';
import { ExemptZone, formatMileage } from './ExemptZoneManager';
import { ShieldAlert, Eye, EyeOff } from 'lucide-react';

interface MileageTrendChartProps {
  data: PavementData[];
  route: string;
  direction: string;
  lane: string;
  mergedLaneKey?: string;
  type: 'iri' | 'sn' | 'prqi';
  exemptZones?: ExemptZone[];
}

const COLORS = ['#94a3b8', '#38bdf8', '#818cf8', '#c084fc', '#f43f5e', '#fb923c', '#4ade80'];

export const MileageTrendChart: React.FC<MileageTrendChartProps> = ({ 
  data, route, direction, lane, mergedLaneKey, type, exemptZones = [] 
}) => {
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set());
  const [showExemptMarkers, setShowExemptMarkers] = useState<boolean>(true);

  // isMerged 模式下，dataKey = "{date}_{lane}"；點圖例時同時切換同一日期的兩條線
  const handleLegendClick = (dateKey: string) => {
    if (isMerged) {
      // dateKey 是日期，一次切換同日期的第二 & 第三
      setHiddenYears(prev => {
        const next = new Set(prev);
        const k2 = `${dateKey}_第二車道`;
        const k3 = `${dateKey}_第三車道`;
        const isHidden = next.has(k2) || next.has(k3);
        if (isHidden) {
          next.delete(k2);
          next.delete(k3);
        } else {
          next.add(k2);
          next.add(k3);
        }
        return next;
      });
    } else {
      setHiddenYears(prev => {
        const next = new Set(prev);
        if (next.has(dateKey)) next.delete(dateKey);
        else next.add(dateKey);
        return next;
      });
    }
  };

  // 合併模式：僅 SN 圖啟用，讓第二、第三車道各自發一條線（國4 16k前三車道、後二車道的外側連貫性）
  const isMerged = !!(mergedLaneKey && lane === mergedLaneKey && type === 'sn');

  const chartData = useMemo(() => {
    const laneFilter = (d: PavementData): boolean => {
      if (isMerged) return d.lane === '第二車道' || d.lane === '第三車道';
      // IRI/PRQI 選到合併選項時，降級為全車道顯示
      if (mergedLaneKey && lane === mergedLaneKey) return true;
      if (!lane || lane === '全車道') return true;
      return d.lane === lane;
    };

    const filtered = data.filter(d =>
      d.route === route &&
      d.direction === direction &&
      laneFilter(d) &&
      (type === 'iri' ? d.iri > 0 : type === 'sn' ? d.sn > 0 : d.prqi > 0)
    );

    const byMileage: Record<number, any> = {};
    const keysSet = new Set<string>();

    filtered.forEach(d => {
      if (!byMileage[d.mileage]) {
        byMileage[d.mileage] = { mileage: d.mileage };
      }
      // 合併模式：dataKey = "{date}_{lane}" 讓第二、第三車道分兩條線
      const dataKey = isMerged ? `${d.date}_${d.lane}` : d.date;

      if (!byMileage[d.mileage][dataKey]) {
        byMileage[d.mileage][dataKey] = { sum: 0, count: 0 };
      }
      byMileage[d.mileage][dataKey].sum += type === 'iri' ? d.iri : type === 'sn' ? d.sn : d.prqi;
      byMileage[d.mileage][dataKey].count += 1;
      keysSet.add(dataKey);
    });

    const sortedRaw = Object.values(byMileage).map((item: any) => {
      const result: any = { mileage: item.mileage };
      keysSet.forEach(key => {
        if (item[key]) {
          result[key] = Number((item[key].sum / item[key].count).toFixed(2));
        }
      });
      return result;
    }).sort((a, b) => a.mileage - b.mileage);

    // ── 斷點處理：若相鄰兩測點間距大於 0.3km (300m)，視為施工跳區或未檢測區間，插入 null 斷點不跨區連線
    const BREAK_GAP_THRESHOLD = 0.3;
    const processedData: any[] = [];
    for (let i = 0; i < sortedRaw.length; i++) {
      const curr = sortedRaw[i];
      if (i > 0) {
        const prev = sortedRaw[i - 1];
        const diff = curr.mileage - prev.mileage;
        if (diff > BREAK_GAP_THRESHOLD) {
          const nullPrev: any = { mileage: Number((prev.mileage + 0.001).toFixed(4)) };
          const nullCurr: any = { mileage: Number((curr.mileage - 0.001).toFixed(4)) };
          keysSet.forEach(k => {
            nullPrev[k] = null;
            nullCurr[k] = null;
          });
          processedData.push(nullPrev);
          processedData.push(nullCurr);
        }
      }
      processedData.push(curr);
    }

    const sortedKeys = Array.from(keysSet).sort((a, b) => a.localeCompare(b));

    // isMerged 模式：提取不重複的日期列表，供自訂圖例用
    const mergedDates = isMerged
      ? Array.from(new Set(Array.from(keysSet).map(k => k.split('_')[0]))).sort()
      : [];

    return { data: processedData, keys: sortedKeys, mergedDates };
  }, [data, route, direction, type, lane, isMerged]);

  // 篩選與目前路線與方向相符的免測規則
  const relevantExemptZones = useMemo(() => {
    if (!exemptZones || exemptZones.length === 0) return [];
    return exemptZones.filter(z => {
      if (z.route !== route) return false;
      if (z.direction && z.direction !== direction) return false;
      return true;
    });
  }, [exemptZones, route, direction]);

  // 取得目前圖表里程邊界與落在可視範圍的免測規則
  const { minMileage, maxMileage, visibleExemptZones } = useMemo(() => {
    if (chartData.data.length === 0) {
      return { minMileage: 0, maxMileage: 0, visibleExemptZones: [] };
    }
    const minM = chartData.data[0].mileage;
    const maxM = chartData.data[chartData.data.length - 1].mileage;
    const visible = relevantExemptZones.filter(z => {
      if (z.type === 'point') {
        return z.mileage >= minM - 0.05 && z.mileage <= maxM + 0.05;
      } else {
        return z.start <= maxM && z.end >= minM;
      }
    });
    return { minMileage: minM, maxMileage: maxM, visibleExemptZones: visible };
  }, [chartData.data, relevantExemptZones]);

  // 判斷某里程是否命中免測規則 (供 Tooltip 顯示)
  const getExemptInfoAt = (m: number) => {
    return relevantExemptZones.find(z => {
      if (z.type === 'point') {
        return Math.abs(z.mileage - m) <= 0.05;
      } else {
        return m >= z.start - 0.005 && m <= z.end + 0.005;
      }
    });
  };

  // 自訂懸浮提示 Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const validPayload = payload.filter((entry: any) => entry.value !== null && entry.value !== undefined);
    if (validPayload.length === 0) return null;
    const m = Number(label);
    const exempt = getExemptInfoAt(m);

    return (
      <div className="bg-white/95 backdrop-blur-sm p-3 rounded-xl border border-slate-200 shadow-xl text-xs space-y-1.5 min-w-[200px]">
        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
          <span className="font-bold text-slate-700">里程: {formatMileage(m)}</span>
          <span className="text-[10px] text-slate-400 font-mono">({m.toFixed(3)}k)</span>
        </div>

        {exempt && (
          <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <div className="leading-tight">
              <span className="font-bold text-[11px] text-amber-900">
                {exempt.type === 'point' ? '伸縮縫免測單點' : '免測區間'}
              </span>
              {exempt.label && (
                <span className="block text-[10px] text-amber-700 truncate max-w-[170px]">{exempt.label}</span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1 pt-0.5">
          {validPayload.map((entry: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                {entry.name}:
              </span>
              <span className="font-semibold text-slate-800 font-mono">
                {entry.value !== undefined ? entry.value : '-'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (chartData.data.length === 0) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
        無足夠資料繪製趨勢圖 (Not enough data)
      </div>
    );
  }

  const title = type === 'iri' ? 'IRI 歷年變化趨勢' : type === 'sn' ? 'SN 歷年變化趨勢' : 'PRQI 歷年變化趨勢';
  const yAxisLabel = type === 'iri' ? 'IRI (m/km)' : type === 'sn' ? 'SN' : 'PRQI';
  // 合併模式：legend name 顯示為 "{date} (第二/三車道)"
  const formatLegendKey = (key: string) => {
    if (isMerged) {
      const [date, ...laneParts] = key.split('_');
      return `${date} (${laneParts.join('_')})`;
    }
    return key;
  };

  return (
    <div className="w-full bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
      {/* 標題與標記開關控制列 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-lg font-bold text-slate-800">
            {title} - {route} {direction}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            車道：{lane || '全車道'} | 橫軸：里程位置 (k) | 縱軸：{yAxisLabel}
          </p>
        </div>

        {type === 'iri' && relevantExemptZones.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* 免測標記小圖例說明 */}
            <div className="flex items-center gap-3 text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-amber-200 border border-amber-400 rounded-xs"></span>
                免測區間
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-orange-500 border-t border-dashed border-orange-600"></span>
                伸縮縫單點
              </span>
            </div>

            {/* 標記開關按鈕 */}
            <button
              type="button"
              onClick={() => setShowExemptMarkers(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                showExemptMarkers
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-xs'
                  : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200'
              }`}
              title="切換是否在趨勢圖上標記免測路段與伸縮縫"
            >
              {showExemptMarkers ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showExemptMarkers 
                ? `已標記免測 (${visibleExemptZones.length} 處)` 
                : `顯示免測標記 (${visibleExemptZones.length})`}
            </button>
          </div>
        )}
      </div>

      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData.data} margin={{ top: 15, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis 
              dataKey="mileage" 
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#64748b' }} 
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              tickFormatter={(v) => `${v}k`}
              label={{ value: '里程 (k)', position: 'bottom', fill: '#64748b' }}
            />
            <YAxis 
              tick={{ fill: '#64748b' }} 
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#64748b' }}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip />} />
            {!isMerged && (
              <Legend 
                wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }} 
                onClick={(e: any) => handleLegendClick(String(e.dataKey))}
              />
            )}
            {isMerged && (
              // 自訂圖例：同日期二三車道合併為一個圖例項目
              <Legend
                content={() => (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '20px', justifyContent: 'center' }}>
                    {chartData.mergedDates.map((date, i) => {
                      const k2 = `${date}_第二車道`;
                      const k3 = `${date}_第三車道`;
                      const isHidden = hiddenYears.has(k2) || hiddenYears.has(k3);
                      const color = COLORS[i % COLORS.length];
                      return (
                        <div
                          key={date}
                          onClick={() => handleLegendClick(date)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            cursor: 'pointer', opacity: isHidden ? 0.35 : 1,
                            userSelect: 'none', fontSize: '13px', color: '#475569'
                          }}
                        >
                          <svg width="28" height="12">
                            <line x1="0" y1="6" x2="28" y2="6" stroke={color} strokeWidth="2" strokeDasharray={i % 2 === 1 ? '4 2' : undefined} />
                            <circle cx="14" cy="6" r="3" fill={color} />
                          </svg>
                          {date} (第二+三車道)
                        </div>
                      );
                    })}
                  </div>
                )}
              />
            )}

            {/* 標準閥值參考線 */}
            {type === 'iri' && (
              <>
                <ReferenceLine y={1.0} stroke="#3b82f6" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.0', fill: '#3b82f6', fontSize: 12 }} />
                <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.3', fill: '#22c55e', fontSize: 12 }} />
                <ReferenceLine y={1.75} stroke="#eab308" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.75', fill: '#eab308', fontSize: 12 }} />
                <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=2.0', fill: '#ef4444', fontSize: 12 }} />
                <ReferenceLine y={2.5} stroke="#9333ea" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=2.5', fill: '#9333ea', fontSize: 12 }} />
              </>
            )}
            {type === 'sn' && (
              <>
                <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'SN=35', fill: '#ef4444', fontSize: 12 }} />
              </>
            )}
            {type === 'prqi' && (
              <>
                <ReferenceLine y={0.2} stroke="#22c55e" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: '良好 (0.2)', fill: '#22c55e', fontSize: 12 }} />
                <ReferenceLine y={0.3} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: '不佳 (0.3)', fill: '#ef4444', fontSize: 12 }} />
              </>
            )}

            {/* 免測路段標記：僅 IRI 圖顯示 */}
            {type === 'iri' && showExemptMarkers && visibleExemptZones.map((z, idx) => {
              if (z.type === 'range') {
                return (
                  <ReferenceArea
                    key={z.id || `exempt-range-${idx}`}
                    x1={z.start}
                    x2={z.end}
                    fill="#fef3c7"
                    fillOpacity={0.6}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    ifOverflow="hidden"
                    label={{
                      value: z.label ? `免測: ${z.label}` : '免測區間',
                      position: 'insideTop',
                      fill: '#b45309',
                      fontSize: 10,
                      fontWeight: 600,
                      offset: 6
                    }}
                  />
                );
              } else {
                return (
                  <ReferenceLine
                    key={z.id || `exempt-point-${idx}`}
                    x={z.mileage}
                    stroke="#ea580c"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    ifOverflow="hidden"
                    label={{
                      value: z.label ? `${z.label} (${formatMileage(z.mileage)})` : `伸縮縫 ${formatMileage(z.mileage)}`,
                      position: 'top',
                      fill: '#c2410c',
                      fontSize: 10,
                      fontWeight: 600
                    }}
                  />
                );
              }
            })}

            {chartData.keys.map((key, index) => {
              // isMerged 模式：同日期的第二、第三車道用同一色（跟自訂圖例一致）
              const colorIndex = isMerged
                ? chartData.mergedDates.indexOf(key.split('_')[0])
                : index;
              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={formatLegendKey(key)}
                  stroke={COLORS[(colorIndex >= 0 ? colorIndex : index) % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  hide={hiddenYears.has(key)}
                  strokeOpacity={hiddenYears.has(key) ? 0.2 : 1}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
