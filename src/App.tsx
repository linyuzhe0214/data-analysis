import React, { useState, useMemo, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, FileDown, Activity, AlertTriangle, CheckCircle, Map, TrendingUp } from 'lucide-react';
import { PavementData } from './types';
import { generateMockData } from './data/mockData';
import { MileageTrendChart } from './components/MileageTrendChart';
import { ColorMap } from './components/ColorMap';
import { RawDataDashboard } from './components/RawDataDashboard';
import { RawIriData, RawSnData, parseIRIFile, parseSNFile } from './lib/excelParser';

export default function App() {
  const [data, setData] = useState<PavementData[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedDirection, setSelectedDirection] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | ''>('');
  const [activeTab, setActiveTab] = useState<'trends' | 'iri-map' | 'raw-data'>('trends');
  const [rawIriData, setRawIriData] = useState<RawIriData[]>([]);
  const [rawSnData, setRawSnData] = useState<RawSnData[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iriFileInputRef = useRef<HTMLInputElement>(null);
  const snFileInputRef = useRef<HTMLInputElement>(null);

  const routes = useMemo(() => {
    const dataRoutes = Array.from(new Set(data.map(d => d.route))) as string[];
    const predefined = ['國道1號', '國道3號', '國道4號'];
    const others = dataRoutes.filter(r => !predefined.includes(r)).sort();
    return [...predefined.filter(r => dataRoutes.includes(r)), ...others];
  }, [data]);

  const availableDirections = useMemo(() => {
    if (selectedRoute === '國道4號') return ['東向', '西向'];
    if (selectedRoute === '國道1號' || selectedRoute === '國道3號') return ['南下', '北上'];
    return Array.from(new Set(data.filter(d => d.route === selectedRoute).map(d => d.direction))).sort();
  }, [selectedRoute, data]);

  const years = useMemo(() => Array.from(new Set(data.map(d => d.year))).sort((a: number, b: number) => b - a), [data]);

  useEffect(() => {
    if (data.length > 0) {
      if (!selectedRoute || !routes.includes(selectedRoute)) setSelectedRoute(routes[0]);
      if (!selectedYear || !years.includes(selectedYear)) setSelectedYear(years[0]);
    }
  }, [data, routes, years]);

  useEffect(() => {
    if (availableDirections.length > 0 && !availableDirections.includes(selectedDirection)) {
      setSelectedDirection(availableDirections[0]);
    }
  }, [availableDirections, selectedDirection]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData: PavementData[] = results.data
          .filter((row: any) => row.year && row.route && row.direction && row.mileage !== undefined && row.iri !== undefined && row.sn !== undefined)
          .map((row: any) => ({
            year: Number(row.year),
            route: String(row.route),
            direction: String(row.direction),
            lane: row.lane ? String(row.lane) : '外側車道',
            mileage: Number(row.mileage),
            iri: Number(row.iri),
            sn: Number(row.sn)
          }));
        
        if (parsedData.length > 0) {
          setData(parsedData);
        } else {
          alert('無法解析資料，請確認 CSV 格式包含: year, route, direction, mileage, iri, sn');
        }
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        alert('檔案解析發生錯誤');
      }
    });
  };

  const handleRawIriUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      const allData: RawIriData[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await parseIRIFile(files[i]);
        console.log(`Parsed IRI File ${i}:`, result);
        allData.push(...result);
      }
      if (allData.length === 0) {
        alert('檔案讀取成功，但未能辨識出任何有效的 IRI 資料。請確認檔案內容符合預期格式（需有結束里程、平均IRI 等欄位）。');
        return;
      }
      setRawIriData(prev => [...prev, ...allData]);
      setActiveTab('raw-data');
    } catch (err) {
      console.error(err);
      alert('IRI 檔案解析失敗，請確認檔案格式');
    }
  };

  const handleRawSnUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      const allData: RawSnData[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await parseSNFile(files[i]);
        console.log(`Parsed SN File ${i}:`, result);
        allData.push(...result);
      }
      if (allData.length === 0) {
        alert('檔案讀取成功，但未能辨識出任何有效的 SN 資料。請確認檔案內容是否有包含「測試里程」等欄位。');
        return;
      }
      setRawSnData(prev => [...prev, ...allData]);
      setActiveTab('raw-data');
    } catch (err) {
      console.error(err);
      alert('SN 檔案解析失敗，請確認檔案格式');
    }
  };

  const loadMockData = () => {
    setData(generateMockData());
  };

  const currentViewData = useMemo(() => {
    return data.filter(d => 
      d.route === selectedRoute && 
      d.direction === selectedDirection && 
      d.year === selectedYear
    );
  }, [data, selectedRoute, selectedDirection, selectedYear]);

  const stats = useMemo(() => {
    if (activeTab !== 'trends') return null;
    const trendData = data.filter(d => d.route === selectedRoute && d.direction === selectedDirection);
    if (trendData.length === 0) return null;
    
    const avgIri = trendData.reduce((acc, curr) => acc + curr.iri, 0) / trendData.length;
    const avgSn = trendData.reduce((acc, curr) => acc + curr.sn, 0) / trendData.length;
    
    const poorIriCount = trendData.filter(d => d.iri >= 2.0).length;
    const poorPercent = (poorIriCount / trendData.length) * 100;

    const iriGte1Count = trendData.filter(d => d.iri >= 1.0).length;
    const iriGte1Percent = (iriGte1Count / trendData.length) * 100;

    const mileages: number[] = Array.from(new Set<number>(trendData.map(d => d.mileage)));
    const totalLength = mileages.length > 0 ? Math.max(...mileages) - Math.min(...mileages) : 0;

    return {
      avgIri: avgIri.toFixed(2),
      avgSn: avgSn.toFixed(1),
      poorPercent: poorPercent.toFixed(1),
      iriGte1Percent: iriGte1Percent.toFixed(1),
      totalLength: totalLength.toFixed(1)
    };
  }, [data, selectedRoute, selectedDirection, activeTab]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Map className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-800">高速公路鋪面檢測分析平台</h1>
          </div>
          <div className="flex items-center gap-3">
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
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
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              上傳歷史 CSV
            </button>
            <div className="h-6 w-px bg-slate-300"></div>
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
            <button 
              onClick={loadMockData}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 border border-transparent rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm ml-2"
            >
              <FileDown className="w-4 h-4" />
              載入範例資料
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Activity className="w-16 h-16 text-slate-300 mb-4" />
            <h2 className="text-xl font-medium text-slate-700 mb-2">尚未載入資料</h2>
            <p className="mb-6">請上傳包含檢測資料的 CSV 檔案，或載入範例資料開始分析。</p>
            <div className="flex gap-4">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                上傳 CSV
              </button>
              <button 
                onClick={loadMockData}
                className="px-6 py-2.5 bg-blue-600 rounded-lg font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
              >
                載入範例資料
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">路線:</label>
                <select 
                  value={selectedRoute} 
                  onChange={(e) => setSelectedRoute(e.target.value)}
                  className="border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  {routes.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              
              {activeTab === 'trends' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-600">方向:</label>
                  <select 
                    value={selectedDirection} 
                    onChange={(e) => setSelectedDirection(e.target.value)}
                    className="border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    {availableDirections.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}

              {activeTab === 'iri-map' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-600">年度 (僅色塊圖與統計適用):</label>
                  <select 
                    value={selectedYear} 
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    {years.map(y => <option key={y} value={y}>{y} 年</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Tabs Navigation */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
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
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'iri-map'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Map className="w-4 h-4" />
                  IRI 色塊圖 (獨立頁面)
                </div>
              </button>
              <button
                onClick={() => setActiveTab('raw-data')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'raw-data'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  原始報表分析
                  {(rawIriData.length > 0 || rawSnData.length > 0) && (
                    <span className="ml-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                      {rawIriData.length + rawSnData.length} 筆
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'trends' && (
              <div className="space-y-6">
                {/* Stats Cards for trends */}
                {stats && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                      <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                        <Activity className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">平均 IRI</p>
                        <p className="text-2xl font-bold text-slate-800">{stats.avgIri}</p>
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                      <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
                        <Activity className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">平均 SN</p>
                        <p className="text-2xl font-bold text-slate-800">{stats.avgSn}</p>
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                      <div className="p-3 bg-orange-50 text-orange-600 rounded-lg">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">需注意比例 (IRI ≥ 1)</p>
                        <p className="text-2xl font-bold text-slate-800">{stats.iriGte1Percent}%</p>
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                      <div className="p-3 bg-red-50 text-red-600 rounded-lg">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">不良比例 (IRI ≥ 2)</p>
                        <p className="text-2xl font-bold text-slate-800">{stats.poorPercent}%</p>
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                      <div className="p-3 bg-green-50 text-green-600 rounded-lg">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">分析總長度</p>
                        <p className="text-2xl font-bold text-slate-800">{stats.totalLength} km</p>
                      </div>
                    </div>
                  </div>
                )}
                <MileageTrendChart data={data} route={selectedRoute} direction={selectedDirection} type="iri" />
                <MileageTrendChart data={data} route={selectedRoute} direction={selectedDirection} type="sn" />
              </div>
            )}

            {activeTab === 'iri-map' && (
              <div className="space-y-6">

                {availableDirections.map(dir => (
                  <ColorMap 
                    key={dir}
                    data={data.filter(d => d.route === selectedRoute && d.direction === dir && d.year === selectedYear)} 
                    title={`${selectedYear}年 ${selectedRoute} - ${dir} 全段 IRI 分布圖`} 
                  />
                ))}
              </div>
            )}

            {activeTab === 'raw-data' && (
              <RawDataDashboard iriData={rawIriData} snData={rawSnData} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
