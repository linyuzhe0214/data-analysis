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
  ReferenceLine
} from 'recharts';
import { PavementData } from '../types';

interface MileageTrendChartProps {
  data: PavementData[];
  route: string;
  direction: string;
  lane: string;
  mergedLaneKey?: string;
  type: 'iri' | 'sn' | 'prqi';
}

const COLORS = ['#94a3b8', '#38bdf8', '#818cf8', '#c084fc', '#f43f5e', '#fb923c', '#4ade80'];

export const MileageTrendChart: React.FC<MileageTrendChartProps> = ({ data, route, direction, lane, mergedLaneKey, type }) => {
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set());

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
      return !lane || d.lane === lane;
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

    const processedData = Object.values(byMileage).map((item: any) => {
      const result: any = { mileage: item.mileage };
      keysSet.forEach(key => {
        if (item[key]) {
          result[key] = Number((item[key].sum / item[key].count).toFixed(2));
        }
      });
      return result;
    }).sort((a, b) => a.mileage - b.mileage);

    const sortedKeys = Array.from(keysSet).sort((a, b) => a.localeCompare(b));

    // isMerged 模式：提取不重複的日期列表，供自訂圖例用
    const mergedDates = isMerged
      ? Array.from(new Set(Array.from(keysSet).map(k => k.split('_')[0]))).sort()
      : [];

    return { data: processedData, keys: sortedKeys, mergedDates };
  }, [data, route, direction, type, lane, isMerged]);

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
    <div className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">
        {title} - {route} {direction}
      </h3>
      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData.data} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis 
              dataKey="mileage" 
              tick={{ fill: '#64748b' }} 
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: '里程 (k)', position: 'bottom', fill: '#64748b' }}
            />
            <YAxis 
              tick={{ fill: '#64748b' }} 
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#64748b' }}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              labelFormatter={(label) => `里程: ${label}k`}
            />
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
                  connectNulls={true}
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
