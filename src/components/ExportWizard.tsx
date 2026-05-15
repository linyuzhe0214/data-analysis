import React, { useState, useMemo } from 'react';
import { Download, X, Settings2 } from 'lucide-react';
import { PavementData } from '../types';
import { ExportManualValues, generateExportExcel } from '../lib/exportUtils';

interface ExportWizardProps {
  data: PavementData[];
  onClose: () => void;
}

export const ExportWizard: React.FC<ExportWizardProps> = ({ data, onClose }) => {
  const [category, setCategory] = useState<'IRI' | 'SN' | 'PRQI'>('SN');
  const [selectedRoute, setSelectedRoute] = useState<string>('全部');

  const routes = useMemo(() => {
    const rSet = new Set<string>();
    data.forEach(d => {
      if (category === 'IRI' && d.iri > 0) rSet.add(d.route);
      if (category === 'SN' && d.sn > 0) rSet.add(d.route);
      if (category === 'PRQI' && d.prqi > 0) rSet.add(d.route);
    });
    return ['全部', ...Array.from(rSet).sort()];
  }, [data, category]);

  React.useEffect(() => {
    setSelectedRoute('全部');
  }, [category]);

  // 依據選擇的種類、路線，取得所有不重複且有效的日期
  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    data.forEach(d => {
      if (selectedRoute !== '全部' && d.route !== selectedRoute) return;

      if (category === 'IRI' && d.iri > 0) dates.add(d.date);
      if (category === 'SN' && d.sn > 0) dates.add(d.date);
      if (category === 'PRQI' && d.prqi > 0) dates.add(d.date);
    });
    return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }, [data, category, selectedRoute]);

  const [selectedDate, setSelectedDate] = useState<string>('');

  // 更新 selectedDate 以避免選到無效的日期
  React.useEffect(() => {
    if (availableDates.length > 0 && !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    } else if (availableDates.length === 0) {
      setSelectedDate('');
    }
  }, [availableDates, selectedDate]);

  const [manualValues, setManualValues] = useState<ExportManualValues>({
    unit: 'CY',
    personnel: 'CY',
    weather: '無',
    tmp: '0',
    atmp: '0',
    description: '無',
    isAssessment: '否'
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setManualValues(prev => ({ ...prev, [name]: value }));
  };

  const handleExport = () => {
    if (!selectedDate) {
      alert('請選擇有效的檢測日期');
      return;
    }

    // 篩選對應日期與種類有數值的資料
    const filteredData = data.filter(d => {
      if (d.date !== selectedDate) return false;
      if (selectedRoute !== '全部' && d.route !== selectedRoute) return false;

      if (category === 'IRI') return d.iri > 0;
      if (category === 'SN') return d.sn > 0;
      if (category === 'PRQI') return d.prqi > 0;
      return false;
    });

    if (filteredData.length === 0) {
      alert('該條件下無有效資料可匯出');
      return;
    }

    const routeStr = selectedRoute !== '全部' ? `_${selectedRoute}` : '';
    const fileName = `${category}${routeStr}_${selectedDate.replace(/-/g, '')}.xlsx`;
    generateExportExcel(filteredData, category, manualValues, fileName);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-600" />
            匯出資料至系統範本
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* 基本篩選 */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-400" /> 匯出資料篩選
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">資料種類</label>
                <select 
                  value={category} 
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="SN">SN 值</option>
                  <option value="PRQI">PRQI 值</option>
                  <option value="IRI">IRI 值</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">路線篩選</label>
                <select 
                  value={selectedRoute} 
                  onChange={(e) => setSelectedRoute(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  {routes.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">檢測時間</label>
                <select 
                  value={selectedDate} 
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100 disabled:text-slate-400"
                  disabled={availableDates.length === 0}
                >
                  {availableDates.length === 0 ? (
                    <option value="">無可用資料</option>
                  ) : (
                    availableDates.map(d => <option key={d} value={d}>{d}</option>)
                  )}
                </select>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100"></div>

          {/* 統一值設定 */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-400" /> 報表通用欄位設定
            </h3>
            <p className="text-xs text-slate-500">以下欄位將會統一帶入匯出的 Excel 檔案中所有資料列。</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">檢測單位</label>
                <input 
                  type="text" name="unit" value={manualValues.unit} onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">檢測人員</label>
                <input 
                  type="text" name="personnel" value={manualValues.personnel} onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">天氣</label>
                <select 
                  name="weather" value={manualValues.weather} onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="晴">晴</option>
                  <option value="陰">陰</option>
                  <option value="雨">雨</option>
                  <option value="無">無</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">資料說明</label>
                <input 
                  type="text" name="description" value={manualValues.description} onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">TMP (若未知填 0)</label>
                <input 
                  type="number" name="tmp" value={manualValues.tmp} onChange={handleInputChange} step="0.1"
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">ATMP (若未知填 0)</label>
                <input 
                  type="number" name="atmp" value={manualValues.atmp} onChange={handleInputChange} step="0.1"
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">是否為考評用</label>
                <select 
                  name="isAssessment" value={manualValues.isAssessment} onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="是">是</option>
                  <option value="否">否</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors"
          >
            取消
          </button>
          <button 
            onClick={handleExport}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selectedDate || availableDates.length === 0}
          >
            <Download className="w-4 h-4" />
            產生並下載 Excel
          </button>
        </div>
      </div>
    </div>
  );
};
