import React, { useMemo, useState } from 'react';
import { RawIriData, RawSnData } from '../lib/excelParser';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

interface RawDataDashboardProps {
  iriData: RawIriData[];
  snData: RawSnData[];
}

export const RawDataDashboard: React.FC<RawDataDashboardProps> = ({ iriData, snData }) => {
  const [showIri, setShowIri] = useState(true);
  const [showPrqi, setShowPrqi] = useState(false);
  const [showSn, setShowSn] = useState(true);

  // 取得所有的方向與路線，提供篩選
  const availableRoutes = useMemo(() => {
    const routes = new Set<string>();
    iriData.forEach(d => routes.add(d.route));
    // SN 資料若沒路名，我們只能假設或不篩選。目前 parser 中的 SN 沒有路名，通常只有單一路線
    return Array.from(routes).sort();
  }, [iriData]);

  const [selectedRoute, setSelectedRoute] = useState(availableRoutes[0] || '');

  const availableDirections = useMemo(() => {
    const dirs = new Set<string>();
    iriData.filter(d => !selectedRoute || d.route === selectedRoute).forEach(d => dirs.add(d.direction));
    snData.forEach(d => dirs.add(d.direction));
    return Array.from(dirs).sort();
  }, [iriData, snData, selectedRoute]);

  const [selectedDirection, setSelectedDirection] = useState(availableDirections[0] || '');

  const parseMileageToNumber = (m: string) => {
    if (!m) return 0;
    const parts = m.split('k+');
    if (parts.length !== 2) return 0;
    return parseInt(parts[0]) * 1000 + parseInt(parts[1]);
  };

  const chartData = useMemo(() => {
    const merged = new Map<string, any>();

    // 加入 IRI 資料
    iriData.forEach(d => {
      if ((selectedRoute && d.route !== selectedRoute) || (selectedDirection && d.direction !== selectedDirection)) return;
      const key = d.mileage;
      if (!merged.has(key)) merged.set(key, { mileage: key, numericMileage: parseMileageToNumber(key) });
      const item = merged.get(key);
      item.iri = d.avgIri;
      item.prqi = d.avgPrqi;
      item.date = d.date || item.date;
    });

    // 加入 SN 資料
    snData.forEach(d => {
      if (selectedDirection && d.direction !== selectedDirection) return;
      const key = d.mileage;
      if (!merged.has(key)) merged.set(key, { mileage: key, numericMileage: parseMileageToNumber(key) });
      const item = merged.get(key);
      item.sn = d.sn;
      item.date = d.date || item.date;
    });

    return Array.from(merged.values()).sort((a, b) => a.numericMileage - b.numericMileage);
  }, [iriData, snData, selectedRoute, selectedDirection]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-6 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">檢視路線:</label>
          <select 
            value={selectedRoute} 
            onChange={(e) => setSelectedRoute(e.target.value)}
            className="border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {availableRoutes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">檢視方向:</label>
          <select 
            value={selectedDirection} 
            onChange={(e) => setSelectedDirection(e.target.value)}
            className="border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {availableDirections.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div className="h-6 w-px bg-slate-300 mx-2"></div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showIri} onChange={(e) => setShowIri(e.target.checked)} className="rounded text-blue-600" />
            平均 IRI
          </label>
          <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showPrqi} onChange={(e) => setShowPrqi(e.target.checked)} className="rounded text-green-600" />
            平均 PRQI
          </label>
          <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showSn} onChange={(e) => setShowSn(e.target.checked)} className="rounded text-orange-500" />
            SN 值
          </label>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-4">綜合指標分析圖表</h3>
        {chartData.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-slate-400">目前篩選條件下無資料</div>
        ) : (
          <div className="h-[500px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis 
                  dataKey="mileage" 
                  tick={{ fontSize: 12, fill: '#64748B' }}
                  tickMargin={10}
                  minTickGap={30}
                />
                
                {showIri && (
                  <YAxis 
                    yAxisId="iri" 
                    orientation="left" 
                    stroke="#3B82F6" 
                    label={{ value: 'IRI', angle: -90, position: 'insideLeft', fill: '#3B82F6' }}
                  />
                )}
                {showPrqi && (
                  <YAxis 
                    yAxisId="prqi" 
                    orientation="right" 
                    stroke="#10B981" 
                    label={{ value: 'PRQI', angle: -90, position: 'insideRight', fill: '#10B981' }}
                  />
                )}
                {showSn && (
                  <YAxis 
                    yAxisId="sn" 
                    orientation="right" 
                    stroke="#F97316" 
                    domain={[0, 100]}
                    label={{ value: 'SN', angle: -90, position: 'insideRight', fill: '#F97316' }}
                  />
                )}

                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelFormatter={(label, payload) => {
                    const date = payload[0]?.payload?.date;
                    return date ? `${label} (${date})` : label;
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />

                {showIri && (
                  <Line 
                    yAxisId="iri" 
                    type="monotone" 
                    dataKey="iri" 
                    name="平均 IRI" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3B82F6' }} 
                    activeDot={{ r: 6 }} 
                    connectNulls
                  />
                )}
                {showPrqi && (
                  <Line 
                    yAxisId="prqi" 
                    type="monotone" 
                    dataKey="prqi" 
                    name="平均 PRQI" 
                    stroke="#10B981" 
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#10B981' }} 
                    activeDot={{ r: 6 }} 
                    connectNulls
                  />
                )}
                {showSn && (
                  <Line 
                    yAxisId="sn" 
                    type="monotone" 
                    dataKey="sn" 
                    name="SN 值" 
                    stroke="#F97316" 
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#F97316' }} 
                    activeDot={{ r: 6 }} 
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
