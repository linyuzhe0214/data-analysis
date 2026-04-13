import React, { useMemo } from 'react';
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
  type: 'iri' | 'sn';
}

const COLORS = ['#94a3b8', '#38bdf8', '#818cf8', '#c084fc', '#f43f5e', '#fb923c', '#4ade80'];

export const MileageTrendChart: React.FC<MileageTrendChartProps> = ({ data, route, direction, type }) => {
  const chartData = useMemo(() => {
    const filtered = data.filter(d => d.route === route && d.direction === direction);
    
    const byMileage: Record<number, any> = {};
    const yearsSet = new Set<number>();

    filtered.forEach(d => {
      if (!byMileage[d.mileage]) {
        byMileage[d.mileage] = { mileage: d.mileage };
      }
      if (!byMileage[d.mileage][d.year]) {
        byMileage[d.mileage][d.year] = { sum: 0, count: 0 };
      }
      byMileage[d.mileage][d.year].sum += type === 'iri' ? d.iri : d.sn;
      byMileage[d.mileage][d.year].count += 1;
      yearsSet.add(d.year);
    });

    const processedData = Object.values(byMileage).map((item: any) => {
      const result: any = { mileage: item.mileage };
      yearsSet.forEach(year => {
        if (item[year]) {
          result[year] = Number((item[year].sum / item[year].count).toFixed(2));
        }
      });
      return result;
    }).sort((a, b) => a.mileage - b.mileage);

    return {
      data: processedData,
      years: Array.from(yearsSet).sort()
    };
  }, [data, route, direction, type]);

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
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            {type === 'iri' && (
              <>
                <ReferenceLine y={1.0} stroke="#3b82f6" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.0', fill: '#3b82f6', fontSize: 12 }} />
                <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.3', fill: '#22c55e', fontSize: 12 }} />
                <ReferenceLine y={1.75} stroke="#eab308" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=1.75', fill: '#eab308', fontSize: 12 }} />
                <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'IRI=2.0', fill: '#ef4444', fontSize: 12 }} />
              </>
            )}
            {chartData.years.map((year, index) => (
              <Line 
                key={year}
                type="monotone" 
                dataKey={year.toString()} 
                name={`${year}年`} 
                stroke={COLORS[index % COLORS.length]} 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
