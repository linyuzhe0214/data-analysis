import React, { useMemo, useState } from 'react';
import { RawIriData, RawSnData } from '../lib/excelParser';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChevronDown } from 'lucide-react';

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
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200/80 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">檢視路線:</label>
          <div className="relative">
            <select 
              value={selectedRoute} 
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="border border-slate-200 bg-slate-50/70 hover:bg-white focus:bg-white rounded-xl py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 outline-none cursor-pointer focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-[border-color,background-color] appearance-none"
            >
              {availableRoutes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">檢視方向:</label>
          <div className="relative">
            <select 
              value={selectedDirection} 
              onChange={(e) => setSelectedDirection(e.target.value)}
              className="border border-slate-200 bg-slate-50/70 hover:bg-white focus:bg-white rounded-xl py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 outline-none cursor-pointer focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-[border-color,background-color] appearance-none"
            >
              {availableDirections.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="h-5 w-px bg-slate-200 mx-1"></div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showIri} onChange={(e) => setShowIri(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500/20" />
            平均 IRI
          </label>
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showPrqi} onChange={(e) => setShowPrqi(e.target.checked)} className="rounded text-emerald-600 focus:ring-emerald-500/20" />
            平均 PRQI
          </label>
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showSn} onChange={(e) => setShowSn(e.target.checked)} className="rounded text-amber-500 focus:ring-amber-500/20" />
            SN 值
          </label>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-xs border border-slate-200/80">
        <h3 className="text-base font-bold text-slate-900 tracking-tight mb-4">綜合指標分析圖表</h3>
        {chartData.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-slate-400 text-sm">目前篩選條件下無資料</div>
        ) : (
          <div className="h-[500px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="mileage" 
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickMargin={10}
                  minTickGap={30}
                />
                
                {showIri && (
                  <YAxis 
                    yAxisId="iri" 
                    orientation="left" 
                    stroke="#3B82F6" 
                    tick={{ fontSize: 11 }}
                    label={{ value: 'IRI', angle: -90, position: 'insideLeft', fill: '#3B82F6', fontSize: 11 }}
                  />
                )}
                {showPrqi && (
                  <YAxis 
                    yAxisId="prqi" 
                    orientation="right" 
                    stroke="#10B981" 
                    tick={{ fontSize: 11 }}
                    label={{ value: 'PRQI', angle: -90, position: 'insideRight', fill: '#10B981', fontSize: 11 }}
                  />
                )}
                {showSn && (
                  <YAxis 
                    yAxisId="sn" 
                    orientation="right" 
                    stroke="#F97316" 
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    label={{ value: 'SN', angle: -90, position: 'insideRight', fill: '#F97316', fontSize: 11 }}
                  />
                )}

                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid rgba(226, 232, 240, 0.8)', 
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.07)',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(8px)',
                    fontSize: '12px',
                    fontFamily: 'monospace'
                  }}
                  labelFormatter={(label, payload) => {
                    const date = payload[0]?.payload?.date;
                    return date ? `${label} (${date})` : label;
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />

                {showIri && (
                  <Line 
                    yAxisId="iri" 
                    type="monotone" 
                    dataKey="iri" 
                    name="平均 IRI" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3B82F6' }} 
                    activeDot={{ r: 5 }} 
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
                    activeDot={{ r: 5 }} 
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
                    activeDot={{ r: 5 }} 
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

