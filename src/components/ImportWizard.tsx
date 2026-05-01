import React, { useState, useEffect, useMemo } from 'react';
import { MappingRule, readExcelPreview, parseWithMapping } from '../lib/excelParser';
import { Loader2, ArrowRight, Table as TableIcon, CheckCircle, AlertTriangle, Eye } from 'lucide-react';

interface ImportWizardProps {
  files: FileList | File[];
  type: 'iri' | 'sn';
  onConfirm: (rule: MappingRule) => void;
  onCancel: () => void;
}

export const ImportWizard: React.FC<ImportWizardProps> = ({ files, type, onConfirm, onCancel }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [sheetName, setSheetName] = useState('');
  const [parsedPreview, setParsedPreview] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(-1);
  const [rule, setRule] = useState<MappingRule>({
    headerRowIndex: -1,
    columns: {},
    globals: {
      route: '',
      direction: '',
      lane: '',
      date: ''
    }
  });

  useEffect(() => {
    if (files.length === 0) return;
    setLoading(true);
    readExcelPreview(files[0])
      .then(res => {
        setPreviewData(res.data);
        setSheetName(res.sheetName);
        
        // Auto guess header row (row with most columns)
        let maxCols = 0;
        let guessIndex = -1;
        for (let i = 0; i < Math.min(10, res.data.length); i++) {
          const validCols = res.data[i].filter(c => c.trim().length > 0).length;
          if (validCols > maxCols && validCols >= (type === 'iri' ? 5 : 4)) {
            maxCols = validCols;
            guessIndex = i;
          }
        }
        if (guessIndex >= 0) {
          handleSelectHeaderRow(guessIndex, res.data[guessIndex]);
        }
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [files, type]);

  const handleSelectHeaderRow = (idx: number, headers: string[]) => {
    setHeaderRowIndex(idx);
    
    // Auto guess columns based on header text
    const newRule: MappingRule = {
      headerRowIndex: idx,
      columns: {},
      globals: { ...rule.globals }
    };

    const findCol = (keywords: string[]) => {
      return headers.findIndex(h => keywords.some(kw => h.toLowerCase().includes(kw)));
    };

    const cMileage = findCol(['里程']);
    if (cMileage >= 0) newRule.columns.mileage = cMileage;

    const cDate = findCol(['日期', '測試日期']);
    if (cDate >= 0) newRule.columns.date = cDate;
    
    const cTime = findCol(['時間', '測試時間']);
    if (cTime >= 0) newRule.columns.time = cTime;

    const cRoute = findCol(['路線', '國道', '路名']);
    if (cRoute >= 0) newRule.columns.route = cRoute;

    const cDir = findCol(['方向']);
    if (cDir >= 0) newRule.columns.direction = cDir;

    const cLane = findCol(['車道']);
    if (cLane >= 0) newRule.columns.lane = cLane;

    if (type === 'iri') {
      const cIri = findCol(['iri']);
      if (cIri >= 0) newRule.columns.iri = cIri;
      const cPrqi = findCol(['prqi', 'prq']);
      if (cPrqi >= 0) newRule.columns.prqi = cPrqi;
    } else {
      const cSn = findCol(['sn', '抗滑']);
      if (cSn >= 0) newRule.columns.sn = cSn;
    }

    setRule(newRule);
    setParsedPreview(null);
  };

  const handleColumnChange = (field: keyof MappingRule['columns'], colIdxStr: string) => {
    const colIdx = colIdxStr === '' ? undefined : parseInt(colIdxStr, 10);
    setRule(prev => ({
      ...prev,
      columns: { ...prev.columns, [field]: colIdx }
    }));
    setParsedPreview(null);
  };

  const handleGlobalChange = (field: keyof MappingRule['globals'], val: string) => {
    setRule(prev => ({
      ...prev,
      globals: { ...prev.globals, [field]: val }
    }));
    setParsedPreview(null);
  };

  const handleGeneratePreview = async () => {
    setPreviewLoading(true);
    try {
      // 僅拿第一個檔案來試跑預覽
      const parsed = await parseWithMapping([files[0]], rule, type);
      setParsedPreview(parsed.slice(0, 5)); // 只取前 5 筆
    } catch (err: any) {
      alert('解析失敗: ' + (err.message || err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const headerRow = headerRowIndex >= 0 ? previewData[headerRowIndex] : [];

  const requiredFieldsMissing = useMemo(() => {
    if (headerRowIndex < 0) return true;
    if (rule.columns.mileage === undefined) return true;
    if (type === 'iri' && rule.columns.iri === undefined) return true;
    if (type === 'sn' && rule.columns.sn === undefined) return true;
    return false;
  }, [rule, headerRowIndex, type]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <TableIcon className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-800">
              智慧匯入精靈 - {type === 'iri' ? 'IRI 報表' : 'SN 報表'}
            </h2>
            <span className="text-sm font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
              共 {files.length} 個檔案
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-200">
          
          {/* 左側：設定區 */}
          <div className="w-full md:w-1/3 p-6 bg-slate-50 overflow-y-auto space-y-8">
            {/* Step 1 */}
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm">1</span>
                指定表頭與欄位
              </h3>
              
              {headerRowIndex === -1 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex gap-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  請先在右側預覽區點擊「設為表頭」，以指定欄位名稱所在的列。
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600 mb-2">已選擇第 {headerRowIndex + 1} 列作為表頭，請確認系統猜測的對應欄位是否正確：</p>
                  
                  <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    {/* 必填欄位 */}
                    <div className="font-medium text-xs text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">必填欄位</div>
                    <FieldSelect label="里程" value={rule.columns.mileage} options={headerRow} onChange={(v) => handleColumnChange('mileage', v)} required />
                    {type === 'iri' ? (
                      <>
                        <FieldSelect label="平均 IRI" value={rule.columns.iri} options={headerRow} onChange={(v) => handleColumnChange('iri', v)} required />
                        <FieldSelect label="平均 PRQI" value={rule.columns.prqi} options={headerRow} onChange={(v) => handleColumnChange('prqi', v)} />
                      </>
                    ) : (
                      <FieldSelect label="SN 值" value={rule.columns.sn} options={headerRow} onChange={(v) => handleColumnChange('sn', v)} required />
                    )}

                    {/* 選填欄位 */}
                    <div className="font-medium text-xs text-slate-400 uppercase tracking-wider mt-4 mb-2 border-b pb-1">屬性欄位</div>
                    <FieldSelect label="日期" value={rule.columns.date} options={headerRow} onChange={(v) => handleColumnChange('date', v)} />
                    {type === 'iri' && <FieldSelect label="時間" value={rule.columns.time} options={headerRow} onChange={(v) => handleColumnChange('time', v)} />}
                    <FieldSelect label="路線" value={rule.columns.route} options={headerRow} onChange={(v) => handleColumnChange('route', v)} />
                    <FieldSelect label="方向" value={rule.columns.direction} options={headerRow} onChange={(v) => handleColumnChange('direction', v)} />
                    <FieldSelect label="車道" value={rule.columns.lane} options={headerRow} onChange={(v) => handleColumnChange('lane', v)} />
                  </div>
                </div>
              )}
            </div>

            {/* Step 2 */}
            <div className={`${headerRowIndex === -1 ? 'opacity-50 pointer-events-none' : ''}`}>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm">2</span>
                全域與工作表補齊
              </h3>
              <p className="text-sm text-slate-500 mb-3">
                若報表中沒有這些欄位，請在這裡手動指定，或選擇自動擷取，設定將套用到這批所有檔案與工作表中。
              </p>
              
              <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <GlobalInput label="預設日期" value={rule.globals.date} onChange={(v) => handleGlobalChange('date', v)} placeholder="例如: 2024-05-01" />
                <GlobalSelect label="預設路線" value={rule.globals.route} onChange={(v) => handleGlobalChange('route', v)} />
                <GlobalSelect label="預設方向" value={rule.globals.direction} onChange={(v) => handleGlobalChange('direction', v)} />
                <GlobalSelect label="預設車道" value={rule.globals.lane} onChange={(v) => handleGlobalChange('lane', v)} />
              </div>
            </div>
          </div>

          {/* 右側：資料預覽區與解析驗證 */}
          <div className="w-full md:w-2/3 p-6 bg-white flex flex-col gap-6">
            
            {/* 區塊 1: 原始 Excel 預覽 */}
            <div className="flex-1 flex flex-col min-h-[300px]">
              <h3 className="text-base font-bold text-slate-800 mb-2 flex items-center justify-between">
                <span>原始檔案預覽 ({files[0].name})</span>
                {sheetName && <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">工作表: {sheetName}</span>}
              </h3>
              <p className="text-sm text-slate-500 mb-4">請點擊標題列以指定表頭，系統將依此辨識資料結構。</p>
              
              <div className="flex-1 border border-slate-200 rounded-xl overflow-auto bg-slate-50">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    讀取預覽中...
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center h-full text-red-500 gap-3 p-6 text-center">
                    <AlertTriangle className="w-8 h-8" />
                    無法讀取檔案，請確認格式正確 ({error})
                  </div>
                ) : (
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <tbody>
                      {previewData.map((row, rIdx) => {
                        const isHeader = headerRowIndex === rIdx;
                        return (
                          <tr 
                            key={rIdx} 
                            className={`
                              border-b border-slate-200 transition-colors
                              ${isHeader ? 'bg-blue-100' : 'hover:bg-slate-100 bg-white'}
                            `}
                          >
                            <td className="p-2 border-r border-slate-200 w-16 text-center">
                              {isHeader ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">
                                  <CheckCircle className="w-3 h-3" /> 表頭
                                </span>
                              ) : (
                                <button 
                                  onClick={() => handleSelectHeaderRow(rIdx, row)}
                                  className="text-xs font-medium text-slate-500 hover:text-blue-600 px-2 py-1 bg-slate-100 hover:bg-blue-50 rounded"
                                >
                                  設為表頭
                                </button>
                              )}
                            </td>
                            <td className="p-2 border-r border-slate-200 font-mono text-xs text-slate-400 w-8 text-center bg-slate-50">
                              {rIdx + 1}
                            </td>
                            {row.map((cell, cIdx) => (
                              <td 
                                key={cIdx} 
                                className={`p-2 border-r border-slate-200 truncate max-w-xs ${isHeader ? 'font-bold text-slate-800' : 'text-slate-600'}`}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* 區塊 2: 轉換後 JSON 驗證 */}
            {parsedPreview && (
              <div className="h-96 flex flex-col border-t border-slate-200 pt-6">
                <h3 className="text-base font-bold text-green-700 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" /> 準備寫入 GOOGLE 的資料驗證 (前 5 筆)
                </h3>
                <p className="text-sm text-slate-500 mb-4">您可以透過下方表格或原始 JSON 陣列，確認資料結構與欄位名稱是否正確。</p>
                
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
                  {/* 表格視圖 */}
                  <div className="border border-green-200 rounded-xl overflow-auto bg-green-50 shadow-inner">
                    {parsedPreview.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500">
                        未能抓取到任何資料，請檢查必填欄位。
                      </div>
                    ) : (
                      <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-green-100 text-green-800 sticky top-0">
                          <tr>
                            <th className="p-2 border-b border-green-200 w-10 text-center">#</th>
                            {Object.keys(parsedPreview[0]).map(k => (
                              <th key={k} className="p-2 border-b border-green-200 font-bold">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreview.map((row, i) => (
                            <tr key={i} className="border-b border-green-200/50 hover:bg-green-100/50 bg-white">
                              <td className="p-2 border-r border-green-100 text-center text-slate-400">{i + 1}</td>
                              {Object.values(row).map((val: any, j) => (
                                <td key={j} className="p-2 border-r border-green-100 text-slate-700">{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  
                  {/* JSON 視圖 */}
                  <div className="border border-slate-700 rounded-xl overflow-auto bg-slate-900 text-green-400 p-4 shadow-inner">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(parsedPreview, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <button 
            onClick={onCancel}
            className="px-6 py-2.5 text-slate-600 hover:text-slate-800 font-medium hover:bg-slate-200 rounded-lg transition-colors"
          >
            取消匯入
          </button>
          
          {!parsedPreview ? (
            <button 
              disabled={requiredFieldsMissing || previewLoading}
              onClick={handleGeneratePreview}
              className={`
                flex items-center gap-2 px-8 py-2.5 rounded-lg font-bold transition-all shadow-sm
                ${requiredFieldsMissing 
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md'
                }
              `}
            >
              {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              產生解析預覽
            </button>
          ) : (
            <button 
              onClick={() => onConfirm(rule)}
              className="flex items-center gap-2 px-8 py-2.5 rounded-lg font-bold transition-all shadow-sm bg-green-600 text-white hover:bg-green-700 hover:shadow-md"
            >
              <CheckCircle className="w-5 h-5" />
              確認無誤，正式寫入資料庫
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 子元件 Helper ──────────────────────────────────────────────

const FieldSelect = ({ label, value, options, onChange, required }: { label: string, value?: number, options: string[], onChange: (v: string) => void, required?: boolean }) => (
  <div className="flex items-center gap-3">
    <label className="w-20 shrink-0 text-sm font-medium text-slate-700 text-right flex items-center justify-end gap-1">
      {required && <span className="text-red-500">*</span>} {label} :
    </label>
    <select 
      value={value === undefined ? '' : value} 
      onChange={e => onChange(e.target.value)}
      className={`
        flex-1 border rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
        ${value === undefined && required ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50'}
      `}
    >
      <option value="">-- 請選擇欄位 --</option>
      {options.map((opt, i) => (
        <option key={i} value={i}>{opt || `(第 ${i+1} 欄)`}</option>
      ))}
    </select>
  </div>
);

const GlobalInput = ({ label, value, onChange, placeholder }: { label: string, value?: string, onChange: (v: string) => void, placeholder?: string }) => (
  <div className="flex items-center gap-3">
    <label className="w-20 shrink-0 text-sm font-medium text-slate-700 text-right">{label} :</label>
    <input 
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 border border-slate-300 bg-slate-50 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
    />
  </div>
);

const GlobalSelect = ({ label, value, onChange }: { label: string, value?: string, onChange: (v: string) => void }) => (
  <div className="flex items-center gap-3">
    <label className="w-20 shrink-0 text-sm font-medium text-slate-700 text-right">{label} :</label>
    <select 
      value={value || ''} 
      onChange={e => onChange(e.target.value)}
      className="flex-1 border border-slate-300 bg-slate-50 rounded-md py-1.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
    >
      <option value="">-- 不指定預設值 --</option>
      <option value="__SHEET_NAME__">✨ 從工作表名稱自動擷取</option>
      <option disabled>──────────</option>
      {label.includes('路線') && ['國道1號', '國道3號', '國道4號', '國道5號', '國道6號', '國道10號'].map(o => <option key={o} value={o}>{o}</option>)}
      {label.includes('方向') && ['北上', '南下', '東向', '西向'].map(o => <option key={o} value={o}>{o}</option>)}
      {label.includes('車道') && ['內側車道', '中線車道', '外側車道', '第一車道', '第二車道', '第三車道', '第四車道'].map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);
