import React, { useState, useMemo, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, FileDown, Activity, AlertTriangle, CheckCircle, Map, TrendingUp, Loader2, Database } from 'lucide-react';
import { PavementData } from './types';
import { generateMockData } from './data/mockData';
import { MileageTrendChart } from './components/MileageTrendChart';
import { ColorMap } from './components/ColorMap';
import { ImportWizard } from './components/ImportWizard';
import { MappingRule, parseWithMapping } from './lib/excelParser';
import { uploadSNData, uploadIRIData } from './lib/gasService';

type UploadStatus = 'idle' | 'parsing' | 'uploading' | 'done' | 'error';

interface UploadResult {
  type: 'iri' | 'sn';
  fileName: string;
  parsed: number;
  inserted: number;
  status: UploadStatus;
  message?: string;
}

export default function App() {
  const [data, setData] = useState<PavementData[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedDirection, setSelectedDirection] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | ''>('');
  const [activeTab, setActiveTab] = useState<'trends' | 'iri-map'>('trends');
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [wizardState, setWizardState] = useState<{ files: File[], type: 'iri' | 'sn' } | null>(null);

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

  /** 通用上傳處理：擷取檔案後開啟精靈 */
  const handleRawIriUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setWizardState({ files: Array.from(files), type: 'iri' });
    }
    event.target.value = ''; // 允許重複選同一個檔案
  };

  const handleRawSnUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setWizardState({ files: Array.from(files), type: 'sn' });
    }
    event.target.value = '';
  };

  const handleWizardConfirm = async (rule: MappingRule, dryRun: boolean) => {
    if (!wizardState) return;
    const { files, type } = wizardState;
    setWizardState(null);
    setUploading(true);

    let allParsed: any[] = [];
    
    // 1. 本地高速解析階段
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pending: UploadResult = { type, fileName: file.name, parsed: 0, inserted: 0, status: 'parsing' };
      setUploadResults(prev => [...prev, pending]);

      try {
        const parsed = await parseWithMapping([file], rule, type);
        if (parsed.length === 0) {
          setUploadResults(prev => prev.map(r => r === pending ? { ...r, status: 'error', message: '未抓取到有效資料' } : r));
        } else {
          allParsed = allParsed.concat(parsed);
          setUploadResults(prev => prev.map(r => r === pending ? { ...r, parsed: parsed.length, status: 'idle', message: dryRun ? '解析完成 (試跑模式)' : '解析完成，等待合併寫入' } : r));
        }
      } catch (err: any) {
        setUploadResults(prev => prev.map(r => r === pending ? { ...r, status: 'error', message: String(err?.message ?? err) } : r));
      }
    }

    // 2. 批次分塊上傳階段 (Batch Chunking)
    if (allParsed.length > 0) {
      if (dryRun) {
        // 試跑模式：不寫入資料庫，直接更新 UI 與本地資料
        setUploadResults(prev => prev.map(r => (r.type === type && r.status === 'idle') ? { ...r, status: 'done', inserted: r.parsed, message: '🧪 試跑完成 (未寫入)' } : r));
        setData(prev => [...prev, ...allParsed]);
      } else if (import.meta.env.VITE_GAS_URL) {
        // 先將狀態全部切換為 uploading
        setUploadResults(prev => prev.map(r => (r.type === type && r.status === 'idle') ? { ...r, status: 'uploading', message: '正在準備寫入...' } : r));

        const CHUNK_SIZE = 1000; // 每 1000 筆更新一次進度，避免畫面停頓感
        let totalInserted = 0;
        let hasError = false;

        for (let i = 0; i < allParsed.length; i += CHUNK_SIZE) {
          const chunk = allParsed.slice(i, i + CHUNK_SIZE);
          
          // 動態更新進度
          setUploadResults(prev => prev.map(r => 
            (r.type === type && r.status === 'uploading') 
              ? { ...r, message: `正在寫入... (${Math.min(i + CHUNK_SIZE, allParsed.length)} / ${allParsed.length} 筆)` } 
              : r
          ));

          try {
            const res = type === 'iri' ? await uploadIRIData(chunk) : await uploadSNData(chunk);
            if (res.success) {
              totalInserted += (res.inserted ?? chunk.length);
            } else {
              hasError = true;
            }
          } catch (err) {
            hasError = true;
          }
        }

        // 結算狀態並即時更新儀表板資料
        setUploadResults(prev => prev.map(r => 
          (r.type === type && r.status === 'uploading') 
            ? { 
                ...r, 
                status: (hasError && totalInserted === 0) ? 'error' : 'done', 
                inserted: r.parsed, 
                message: hasError ? `部分上傳失敗 (本次總計寫入 ${totalInserted} 筆)` : '' 
              } 
            : r
        ));

        // 成功寫入資料庫後，直接將新資料加入本地狀態，讓儀表板馬上更新！
        if (totalInserted > 0) {
          setData(prev => [...prev, ...allParsed]);
        }

      } else {
        // 沒有 GAS URL 的本地測試狀況
        setUploadResults(prev => prev.map(r => (r.type === type && r.status === 'idle') ? { ...r, status: 'done', inserted: r.parsed, message: '未設定 GAS，僅本地解析' } : r));
        setData(prev => [...prev, ...allParsed]);
      }
    }

    setUploading(false);
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
      {wizardState && (
        <ImportWizard 
          files={wizardState.files} 
          type={wizardState.type} 
          onConfirm={handleWizardConfirm} 
          onCancel={() => setWizardState(null)} 
        />
      )}
      
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
            {uploading && (
              <span className="flex items-center gap-1 text-sm text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                處理中...
              </span>
            )}
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
        {data.length === 0 && uploadResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Activity className="w-16 h-16 text-slate-300 mb-4" />
            <h2 className="text-xl font-medium text-slate-700 mb-2">尚未載入資料</h2>
            <p className="mb-6">請上傳包含檢測資料的 CSV 檔案，或載入範例資料開始分析。</p>
            <div className="flex gap-4">
              <button 
                onClick={() => iriFileInputRef.current?.click()}
                className="px-6 py-2.5 bg-blue-50 border border-blue-200 rounded-lg font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                匯入 IRI 報表
              </button>
              <button 
                onClick={() => snFileInputRef.current?.click()}
                className="px-6 py-2.5 bg-orange-50 border border-orange-200 rounded-lg font-medium text-orange-700 hover:bg-orange-100 transition-colors"
              >
                匯入 SN 報表
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

            {/* 上傳結果列表 */}
            {uploadResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-500" />
                    上傳紀錄
                  </span>
                  <button
                    onClick={() => setUploadResults([])}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                  >
                    清除
                  </button>
                </div>
                <div className="divide-y divide-slate-50">
                  {uploadResults.map((r, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3">
                      {/* 類型標籤 */}
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${
                        r.type === 'iri' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {r.type.toUpperCase()}
                      </span>
                      {/* 檔名 */}
                      <span className="flex-1 text-sm text-slate-700 truncate" title={r.fileName}>{r.fileName}</span>
                      {/* 狀態 */}
                      {r.status === 'parsing' && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Loader2 className="w-3 h-3 animate-spin" />解析中
                        </span>
                      )}
                      {r.status === 'uploading' && (
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <Loader2 className="w-3 h-3 animate-spin" />寫入資料庫 ({r.parsed} 筆)
                        </span>
                      )}
                      {r.status === 'done' && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="w-3 h-3" />
                          已匯入 {r.inserted} 筆
                          {r.message && <span className="text-slate-400"> {r.message}</span>}
                        </span>
                      )}
                      {r.status === 'error' && (
                        <span className="flex items-center gap-1 text-xs text-red-500" title={r.message}>
                          <AlertTriangle className="w-3 h-3" />
                          失敗：{r.message?.slice(0, 60)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  IRI 色塊圖
                </div>
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'trends' && (
              data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-white rounded-xl border border-slate-200">
                  <p className="text-sm">請上傳歷史 CSV 資料以顯示趨勢圖</p>
                </div>
              ) : (
              <div className="space-y-6">
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
              )
            )}

            {activeTab === 'iri-map' && (
              data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-white rounded-xl border border-slate-200">
                  <p className="text-sm">請上傳歷史 CSV 資料以顯示 IRI 色塊圖</p>
                </div>
              ) : (
              <div className="space-y-6">
                {availableDirections.map(dir => (
                  <ColorMap 
                    key={dir}
                    data={data.filter(d => d.route === selectedRoute && d.direction === dir && d.year === selectedYear)} 
                    title={`${selectedYear}年 ${selectedRoute} - ${dir} 全段 IRI 分布圖`} 
                  />
                ))}
              </div>
              )
            )}


          </div>
        )}
      </main>
    </div>
  );
}
