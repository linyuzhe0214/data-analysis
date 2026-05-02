import React, { useMemo } from 'react';
import { PavementData, getIriColor } from '../types';
import { cn } from '../lib/utils';

interface ColorMapProps {
  data: PavementData[];
  title: string;
}

export const ColorMap: React.FC<ColorMapProps> = ({ data, title }) => {
  const { lanes, minMileage, maxMileage, groupedData } = useMemo(() => {
    const lanesSet = new Set<string>();
    let minM = Infinity;
    let maxM = -Infinity;
    const grouped: Record<string, PavementData[]> = {};

    data.forEach(d => {
      lanesSet.add(d.lane);
      if (d.mileage < minM) minM = d.mileage;
      if (d.mileage > maxM) maxM = d.mileage;
      
      if (!grouped[d.lane]) grouped[d.lane] = [];
      grouped[d.lane].push(d);
    });

    // Sort lanes logically (Inner to Outer)
    const laneOrder = ['內側車道', '中線車道', '外側車道'];
    const sortedLanes = Array.from(lanesSet).sort((a, b) => {
      const idxA = laneOrder.indexOf(a);
      const idxB = laneOrder.indexOf(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    });

    // Sort data within each lane by mileage
    sortedLanes.forEach(lane => {
      grouped[lane].sort((a, b) => a.mileage - b.mileage);
    });

    return { 
      lanes: sortedLanes, 
      minMileage: minM === Infinity ? 0 : minM, 
      maxMileage: maxM === -Infinity ? 0 : maxM, 
      groupedData: grouped 
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="w-full h-32 flex items-center justify-center bg-slate-100 rounded-lg border border-slate-200 text-slate-500">
        無資料 (No Data)
      </div>
    );
  }

  return (
    <div className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-500"></div>
            <span className="text-slate-600">IRI ≤ 1.0</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-500"></div>
            <span className="text-slate-600">1.0 &lt; IRI ≤ 1.3</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-yellow-400"></div>
            <span className="text-slate-600">1.3 &lt; IRI ≤ 1.75</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-orange-400"></div>
            <span className="text-slate-600">1.75 &lt; IRI ≤ 2.0</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-orange-600"></div>
            <span className="text-slate-600">2.0 &lt; IRI ≤ 2.5</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-600"></div>
            <span className="text-slate-600">IRI &gt; 2.5</span>
          </div>
        </div>
      </div>

      <div className="relative pt-2 pb-8 flex flex-col gap-1">
        {lanes.map(lane => (
          <div key={lane} className="flex items-center gap-2">
            <div className="w-20 text-xs font-medium text-slate-600 text-right shrink-0">
              {lane}
            </div>
            <div className="flex-1 h-8 flex rounded-sm overflow-hidden bg-slate-100">
              {groupedData[lane].map((point, index) => (
                <div
                  key={`${point.mileage}-${index}`}
                  className={cn("flex-1 h-full hover:opacity-75 transition-opacity cursor-crosshair", getIriColor(point.iri))}
                  title={`里程: ${point.mileage}k\n車道: ${lane}\nIRI: ${point.iri}`}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Axis Labels */}
        <div className="absolute bottom-0 left-[5.5rem] right-0 h-8 flex justify-between items-end px-1 pointer-events-none">
          {Array.from({ length: 11 }).map((_, i) => {
            const m = minMileage + (maxMileage - minMileage) * (i / 10);
            return (
              <div key={i} className="text-[10px] text-slate-500 flex flex-col items-center">
                <div className="w-px h-1.5 bg-slate-300 mb-0.5"></div>
                {m.toFixed(1)}k
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
