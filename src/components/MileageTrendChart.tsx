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
  type: 'iri' | 'sn';
}

const COLORS = ['#94a3b8', '#38bdf8', '#818cf8', '#c084fc', '#f43f5e', '#fb923c', '#4ade80'];

export const MileageTrendChart: React.FC<MileageTrendChartProps> = ({ data, route, direction, lane, type }) => {
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set());

  const handleLegendClick = (e: any) => {
    const dataKey = String(e.dataKey);
    setHiddenYears(prev => {
      const next = new Set(prev);
      if (next.has(dataKey)) {
        next.delete(dataKey);
      } else {
        next.add(dataKey);
      }
      return next;
    });
  };

  const chartData = useMemo(() => {
    const filtered = data.filter(d => 
      d.route === route && 
      d.direction === direction &&
      (!lane || d.lane === lane) &&
      (type === 'iri' ? d.iri > 0 : d.sn > 0)
    );
    
    const byMileage: Record<number, any> = {};
    const keysSet = new Set<string>();

    filtered.forEach(d => {
      if (!byMileage[d.mileage]) {
        byMileage[d.mileage] = { mileage: d.mileage };
      }
      
      const dataKey = d.year.toString();

      if (!byMileage[d.mileage][dataKey]) {
        byMileage[d.mileage][dataKey] = { sum: 0, count: 0 };
      }
      byMileage[d.mileage][dataKey].sum += type === 'iri' ? d.iri : d.sn;
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

    // 對 keys 進行排序，先依年份排序
    const sortedKeys = Array.from(keysSet).sort((a, b) => a.localeCompare(b));

    return {
      data: processedData,
      keys: sortedKeys
    };
  }, [data, route, direction, type, lane]);

  if (chartData.data.length === 0) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
        無足夠資料繪製趨勢圖 (Not enough data)
      </div>
    );
  }

  const title = type === 'iri' ? 'IRI 歷年變化趨勢' : 'SN 歷年變化趨勢';
  const yAxisLabel = type === 'iri' ? 'IRI (m/km)' : 'SN';

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
            <Legend 
              wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }} 
              onClick={handleLegendClick}
            />
            {type === 'iri' && (
              <>
                <ReferenceLine y={1.0} stroke="#3b82f6" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.0', fill: '#3b82f6', fontSize: 12 }} />
                <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.3', fill: '#22c55e', fontSize: 12 }} />
                <ReferenceLine y={1.75} stroke="#eab308" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.75', fill: '#eab308', fontSize: 12 }} />
                <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=2.0', fill: '#ef4444', fontSize: 12 }} />
              </>
            )}
            {chartData.keys.map((key, index) => (
              <Line 
                key={key}
                type="monotone" 
                dataKey={key} 
                name={`${key}年`} 
                stroke={COLORS[index % COLORS.length]} 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
                connectNulls={true}
                hide={hiddenYears.has(key)}
                strokeOpacity={hiddenYears.has(key) ? 0.2 : 1}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
