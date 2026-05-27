import * as XLSX from 'xlsx';

export interface RawIriData {
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM:SS（或空字串）
  mileage: string;
  route: string;     // 國道X號
  direction: string; // 北上/南下/東向/西向
  lane: string;      // 第X車道
  avgIri: number;
  avgPrqi: number;
}

export interface RawSnData {
  date: string;      // YYYY-MM-DD
  mileage: string;
  route: string;     // 國道X號
  direction: string; // 北上/南下/東向/西向
  lane: string;      // 第X車道
  sn: number;
}

// ─── 工具函式 ────────────────────────────────────────────────

/**
 * 從任意字串抽取「國道X號」，支援多種寫法：
 * - 國道1號 / 國道一號
 * - 省道 / 市道（不在範圍內，僅抓國道）
 * - freeway 1 / F1（備用）
 */
const CHINESE_DIGITS: Record<string, string> = {
  '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
  '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
};

const extractHighway = (text: string): string => {
  if (!text) return '';
  // 優先：國道數字號
  let m = text.match(/國道\s*(\d+)\s*號/);
  if (m) return `國道${m[1]}號`;
  // 國道中文數字號
  m = text.match(/國道\s*([一二三四五六七八九十])\s*號/);
  if (m) return `國道${CHINESE_DIGITS[m[1]] ?? m[1]}號`;
  // 備用：只有數字（例如 F1、Freeway 1）
  m = text.match(/[Ff]reeway\s*(\d+)/);
  if (m) return `國道${m[1]}號`;
  return '';
};

/** 民國日期 "1140422" 或 "114/04/22" → "2025-04-22" */
const convertROCDate = (input: string): string => {
  const s = String(input || '').trim();
  // 純數字 7 碼
  let m = s.match(/^(\d{3})(\d{2})(\d{2})/);
  if (m) return `${parseInt(m[1]) + 1911}-${m[2]}-${m[3]}`;
  // 斜線分隔：114/04/22 或 114-04-22
  m = s.match(/^(\d{2,3})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const y = parseInt(m[1]);
    const mo = m[2].padStart(2, '0');
    const d  = m[3].padStart(2, '0');
    return `${y + 1911}-${mo}-${d}`;
  }
  return '';
};

/** 統一把各種日期值轉成 { date: "YYYY-MM-DD", time: "HH:MM:SS" } */
const normalizeDateTimeValue = (val: unknown): { date: string; time: string } => {
  if (!val) return { date: '', time: '' };

  // JS Date 物件（cellDates: true 時出現）
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    const hh = String(val.getHours()).padStart(2, '0');
    const mm = String(val.getMinutes()).padStart(2, '0');
    const ss = String(val.getSeconds()).padStart(2, '0');
    return {
      date: `${y}-${m}-${d}`,
      time: hh === '00' && mm === '00' && ss === '00' ? '' : `${hh}:${mm}:${ss}`,
    };
  }

  const s = String(val).trim();

  // ISO with time：2025-04-22T09:30:00
  if (s.includes('T')) {
    const [datePart, timePart] = s.split('T');
    return { date: datePart, time: timePart?.split('.')[0] ?? '' };
  }

  // 含空白的日期時間：2025-04-22 09:30:00
  if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    const [datePart, timePart] = s.split(' ');
    return { date: datePart, time: timePart ?? '' };
  }

  // 純西元日期 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: '' };

  // 純西元數字 YYYYMMDD (例如 20240514)
  if (/^20\d{6}$/.test(s)) {
    return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, time: '' };
  }

  // 民國日期（含時間）：1140422 09:30:00
  const rocWithTime = s.match(/^(\d{7})\s+(\d{2}:\d{2}(:\d{2})?)/);
  if (rocWithTime) {
    return {
      date: convertROCDate(rocWithTime[1]),
      time: rocWithTime[2],
    };
  }

  // 純民國日期
  const roc = convertROCDate(s);
  if (roc) return { date: roc, time: '' };

  return { date: s, time: '' };
};

/** 166500 → "166k+500"（IRI 里程格式）*/
export const formatMileageIRI = (rawMileage: number | string): string => {
  const m = Number(rawMileage);
  if (isNaN(m)) return String(rawMileage);
  const km    = Math.floor(m / 1000);
  const meter = Math.round(m % 1000);
  return `${km}k+${meter.toString().padStart(3, '0')}`;
};

/** "166+500" → "166k+500"（SN 里程格式）*/
export const formatMileageSN = (rawMileage: string): string => {
  if (!rawMileage || typeof rawMileage !== 'string') return String(rawMileage);
  return rawMileage.replace(/\+/, 'k+');
};

/** 順樁/逆樁 × 國道 → 方向 */
const resolveDirection = (raw: string, highway: string): string => {
  const isRoute4 = highway.includes('4');
  const s = String(raw).trim().toUpperCase();
  
  if (s.includes('逆') || s.includes('北') || s === 'N') return isRoute4 ? '西向' : '北上';
  if (s.includes('順') || s.includes('南') || s === 'S') return isRoute4 ? '東向' : '南下';
  if (s.includes('東') || s === 'E') return isRoute4 ? '東向' : '北上';
  if (s.includes('西') || s === 'W') return isRoute4 ? '西向' : '南下';
  
  if (['北上', '南下', '東向', '西向'].includes(raw)) return raw;
  return raw;
};

/** 車道代碼 N3/S3 → { direction, lane } */
const parseLaneCode = (code: string): { direction: string; lane: string } => {
  const dirMap: Record<string, string> = { N: '北上', S: '南下', E: '東向', W: '西向' };
  const dirChar = code.charAt(0).toUpperCase();
  const laneNum = code.slice(1);
  return {
    direction: dirMap[dirChar] ?? code,
    lane: `第${laneNum}車道`,
  };
};

/** 從 IRI sheet 名稱解析 { route, lane, directionRaw } */
const parseIriSheetName = (sheetName: string) => {
  const laneMatch = sheetName.match(/(內側|中線|外側|第[一二三四五六七八九十百\d]+)車道/);
  const lane      = laneMatch ? laneMatch[0] : '';
  const route     = extractHighway(sheetName);
  const directionRaw = sheetName.includes('逆樁') ? '逆樁'
                     : sheetName.includes('順樁') ? '順樁'
                     : sheetName.includes('北上') ? '北上'
                     : sheetName.includes('南下') ? '南下'
                     : sheetName.includes('東向') ? '東向'
                     : sheetName.includes('西向') ? '西向'
                     : '';
  return { route, lane, directionRaw };
};

// ─── SN Parser ───────────────────────────────────────────────

export const parseSNFile = async (file: File): Promise<RawSnData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data     = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const results: RawSnData[] = [];

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          // Sheet 名稱可能就是民國日期 ex: "1140422"
          const sheetDateConverted = convertROCDate(sheetName.trim());
          let globalDate  = sheetDateConverted || '';
          let globalRoute = '';

          // 先從 sheet name 抽國道別
          globalRoute = extractHighway(sheetName);

          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;

            // Row 0：掃整列，優先抓國道別（如果 sheet name 沒有）
            if (r === 0 || r === 1) {
              const fullText = row.map(c => String(c ?? '')).join(' ');
              if (!globalRoute) globalRoute = extractHighway(fullText);
            }

            // 掃整列找「測試日期」
            for (let c = 0; c < row.length; c++) {
              const cell = String(row[c] ?? '').trim();
              if (cell === '測試日期' && row[c + 1]) {
                const dt = normalizeDateTimeValue(row[c + 1]);
                if (dt.date) globalDate = dt.date;
              } else if (cell.startsWith('測試日期') && cell.length > 4) {
                const dateStr = cell.replace(/^測試日期[：:]*\s*/, '').trim();
                const dt = normalizeDateTimeValue(dateStr);
                if (dt.date) globalDate = dt.date;
              }
            }

            // 掃資料欄：里程 + 車道代碼 + 抗滑值
            for (let c = 0; c < row.length - 2; c++) {
              const cellA = String(row[c]     ?? '').trim(); // 里程 192+000
              const cellB = String(row[c + 1] ?? '').trim(); // 車道代碼 N3
              const cellC = row[c + 2];                       // 抗滑值

              if (
                cellA.includes('+') &&
                /^[NSEWnsew]\d+$/.test(cellB) &&
                !isNaN(Number(cellC))
              ) {
                const { direction, lane } = parseLaneCode(cellB);
                results.push({
                  date:      globalDate,
                  route:     globalRoute,
                  mileage:   formatMileageSN(cellA),
                  direction,
                  lane,
                  sn: Number(cellC),
                });
              }
            }
          }
        });

        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

// ─── IRI Parser ──────────────────────────────────────────────

export const parseIRIFile = async (file: File): Promise<RawIriData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data     = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const results: RawIriData[] = [];

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          const fromSheetName = parseIriSheetName(sheetName);
          let route        = fromSheetName.route;
          let lane         = fromSheetName.lane;
          let directionRaw = fromSheetName.directionRaw;
          let headerRowIndex = -1;

          // 掃前 30 列，補充 metadata
          for (let r = 0; r < Math.min(30, rows.length); r++) {
            const row = rows[r];
            if (!row) continue;

            // 掃整列找國道別（sheet name 沒有的話）
            if (!route) {
              const fullText = row.map(c => String(c ?? '')).join(' ');
              route = extractHighway(fullText);
            }

            const firstCell = String(row[0] ?? '').trim();

            if (!route && firstCell.startsWith('路名')) {
              const val = firstCell.replace(/^路名[：:]*\s*/, '').trim() || String(row[1] ?? '').trim();
              route = extractHighway(val) || val;
            }
            if (!lane && firstCell.startsWith('車道')) {
              const val = firstCell.replace(/^車道[：:]*\s*/, '').trim() || String(row[1] ?? '').trim();
              lane = val.split(/\s+/)[0];
            }
            if (!directionRaw && firstCell.startsWith('方向')) {
              const val = firstCell.replace(/^方向[：:]*\s*/, '').trim() || String(row[1] ?? '').trim();
              directionRaw = val.split(/\s+/)[0];
            }

            const rowStr = row.map(c => String(c ?? '').trim()).join(',');
            if (rowStr.includes('結束里程') && rowStr.includes('平均IRI')) {
              headerRowIndex = r;
              break;
            }
          }

          if (headerRowIndex === -1) return;

          const direction = resolveDirection(directionRaw, route);

          const headers    = rows[headerRowIndex].map(h => String(h ?? '').trim());
          const timeIdx    = headers.findIndex(h => h === '日期時間' || h === '時間' || h === '日期');
          const mileageIdx = headers.findIndex(h => h === '結束里程');
          const avgIriIdx  = headers.findIndex(h => h === '平均IRI');
          const avgPrqiIdx = headers.findIndex(h => h.includes('PRQI') || h.includes('PRQ'));

          if (mileageIdx === -1 || avgIriIdx === -1) return;

          for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            const mileageVal  = row[mileageIdx];
            const avgIriVal   = row[avgIriIdx];
            const avgPrqiVal  = avgPrqiIdx !== -1 ? row[avgPrqiIdx] : 0;

            if (!isNaN(Number(mileageVal)) && !isNaN(Number(avgIriVal))) {
              const rawTime = timeIdx !== -1 ? row[timeIdx] : null;
              const { date, time } = normalizeDateTimeValue(rawTime);
              results.push({
                date,
                time,
                mileage:   formatMileageIRI(mileageVal),
                route,
                direction,
                lane,
                avgIri:  Number(avgIriVal),
                avgPrqi: Number(avgPrqiVal),
              });
            }
          }
        });

        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

// ─── 精靈專用 Parser ──────────────────────────────────────────────

export interface MappingRule {
  headerRowIndex: number;
  columns: {
    mileage?: number;
    iri?: number;
    prqi?: number;
    sn?: number;
    date?: number;
    time?: number;
    route?: number;
    direction?: number;
    lane?: number;
  };
  globals: {
    date?: string;
    route?: string;
    direction?: string;
    lane?: string;
  };
}

export const readExcelPreview = async (file: File): Promise<{ sheetName: string; data: string[][] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
        
        const previewData = rows.slice(0, 30).map(row => row.map(cell => {
          if (cell instanceof Date) {
            // 只取日期部分供預覽
            return cell.toISOString().split('T')[0];
          }
          return String(cell ?? '').trim();
        }));
        
        resolve({ sheetName, data: previewData });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

export const parseWithMapping = async (files: FileList | File[], rule: MappingRule, type: 'iri' | 'sn'): Promise<any[]> => {
  const results: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileData = await new Promise<any[]>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const fileResults: any[] = [];

          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            
            // 如果全域變數設定為 '__SHEET_NAME__'，則自動從 Sheet 名稱解析
            const fallbackFromSheet = parseIriSheetName(sheetName); 
            
            let sheetGlobalDate = rule.globals.date;
            if (sheetGlobalDate === '__SHEET_NAME__') {
              sheetGlobalDate = convertROCDate(sheetName.trim()) || sheetName.trim();
            }

            let sheetGlobalRoute = rule.globals.route;
            if (sheetGlobalRoute === '__SHEET_NAME__') sheetGlobalRoute = fallbackFromSheet.route;
            
            let sheetGlobalDirection = rule.globals.direction;
            if (sheetGlobalDirection === '__SHEET_NAME__') sheetGlobalDirection = resolveDirection(fallbackFromSheet.directionRaw, sheetGlobalRoute || '');
            
            let sheetGlobalLane = rule.globals.lane;
            if (sheetGlobalLane === '__SHEET_NAME__') sheetGlobalLane = fallbackFromSheet.lane;

            // 處理多區塊 (Side-by-Side) 排列的報表，並做終極防呆
            const headerRow = rows[rule.headerRowIndex] || [];
            
            // 建立每個 block 的 column mapping
            const blockMappings: Array<Record<string, number>> = [];
            
            if (rule.columns.mileage !== undefined && headerRow[rule.columns.mileage]) {
              const sanitizeHeader = (h: any) => String(h ?? '').replace(/\s+/g, '');
              const mileageHeaderName = sanitizeHeader(headerRow[rule.columns.mileage]);
              
              const allMileageIndices: number[] = [];
              for (let c = 0; c < headerRow.length; c++) {
                if (sanitizeHeader(headerRow[c]) === mileageHeaderName && mileageHeaderName !== '') {
                  allMileageIndices.push(c);
                }
              }

              if (allMileageIndices.length > 0) {
                const baseMileageIdx = allMileageIndices[0];
                
                // 針對每個 block 建立 mapping
                for (let i = 0; i < allMileageIndices.length; i++) {
                  const currentMileageIdx = allMileageIndices[i];
                  const mappingForThisBlock: Record<string, number> = {};
                  
                  // 對於每一個使用者指定的欄位
                  Object.keys(rule.columns).forEach(k => {
                    const key = k as keyof MappingRule['columns'];
                    const originalColIdx = rule.columns[key];
                    if (originalColIdx === undefined) return;
                    
                    if (key === 'mileage') {
                      mappingForThisBlock[key] = currentMileageIdx;
                      return;
                    }
                    
                    const expectedHeaderName = sanitizeHeader(headerRow[originalColIdx]);
                    
                    // 找出所有與 expectedHeaderName 相同的欄位索引
                    const matchingIndices: number[] = [];
                    for (let c = 0; c < headerRow.length; c++) {
                      if (sanitizeHeader(headerRow[c]) === expectedHeaderName && expectedHeaderName !== '') {
                        matchingIndices.push(c);
                      }
                    }
                    
                    if (matchingIndices.length === allMileageIndices.length) {
                      // 1-to-1 對應：這個欄位在每個 block 都有出現
                      mappingForThisBlock[key] = matchingIndices[i];
                    } else if (matchingIndices.length > 0) {
                      // 數量不符 (例如日期只有一欄)，若是只有一欄就共用
                      if (matchingIndices.length === 1) {
                        mappingForThisBlock[key] = matchingIndices[0];
                      } else {
                        // 有多個但數量對不上，依序取用，超出則拿最後一個
                        mappingForThisBlock[key] = matchingIndices[i] !== undefined ? matchingIndices[i] : matchingIndices[matchingIndices.length - 1];
                      }
                    } else {
                      // 找不到相同名稱，使用相對位置作為 Fallback
                      const offset = currentMileageIdx - baseMileageIdx;
                      mappingForThisBlock[key] = originalColIdx + offset;
                    }
                  });
                  
                  blockMappings.push(mappingForThisBlock);
                }
              }
            }
            
            if (blockMappings.length === 0) {
              // 找不到 mileage 或未設定，退回單一 block
              const defaultMapping: Record<string, number> = {};
              Object.keys(rule.columns).forEach(k => {
                const key = k as keyof MappingRule['columns'];
                if (rule.columns[key] !== undefined) {
                   defaultMapping[key] = rule.columns[key]!;
                }
              });
              blockMappings.push(defaultMapping);
            }

            const lastSeenRoute: Record<number, string> = {};
            const lastSeenDirection: Record<number, string> = {};
            const lastSeenLane: Record<number, string> = {};

            for (let r = rule.headerRowIndex + 1; r < rows.length; r++) {
              const row = rows[r];
              if (!row || row.length === 0) continue;

              for (let bIdx = 0; bIdx < blockMappings.length; bIdx++) {
                const blockCols = blockMappings[bIdx];
                
                const getCellRaw = (colKey: keyof MappingRule['columns']) => {
                  const idx = blockCols[colKey];
                  return idx !== undefined && idx < row.length ? row[idx] : '';
                };
                const getCellStr = (colKey: keyof MappingRule['columns']) => String(getCellRaw(colKey) ?? '').trim();
                
                const mileageRaw = getCellStr('mileage');
                if (!mileageRaw) continue; // 里程是必備欄位，若此區塊為空則跳過

                // 處理日期與時間
                const rawDate = getCellRaw('date');
                const dt = normalizeDateTimeValue(rawDate);
                const dateVal = dt.date || sheetGlobalDate || '';
                
                // 若有單獨的時間欄位，則優先使用，否則使用解析出來的時間
                const timeColVal = getCellStr('time');
                let timeVal = timeColVal;
                if (!timeVal) {
                    timeVal = dt.time;
                }

                // 更新與獲取 lastSeen
                const routeCell = getCellStr('route');
                if (routeCell) lastSeenRoute[bIdx] = routeCell;
                
                const dirCell = getCellStr('direction');
                if (dirCell) lastSeenDirection[bIdx] = dirCell;
                
                const laneCell = getCellStr('lane');
                if (laneCell) lastSeenLane[bIdx] = laneCell;

                // 其他維度資訊 (優先順序: 當下/最後出現的值 > 全域設定 > 空)
                const routeVal = lastSeenRoute[bIdx] || sheetGlobalRoute || '';
                let dirRaw = lastSeenDirection[bIdx] || sheetGlobalDirection || '';
                let directionVal = resolveDirection(dirRaw, routeVal);
                let laneVal = lastSeenLane[bIdx] || sheetGlobalLane || '';

                // 如果車道填的是 W2, E3 這類代碼，自動解析方向與車道
                if (/^[NSEWnsew]\d+$/.test(laneVal)) {
                   const parsedLane = parseLaneCode(laneVal);
                   laneVal = parsedLane.lane;
                   
                   // 如果是 SN 報表，我們一律以「車道代碼」(W2/E3) 解析出來的方向為主，無視錯誤的方向對應
                   if (type === 'sn' || (!dirRaw && !sheetGlobalDirection)) {
                       directionVal = parsedLane.direction;
                   }
                }

              if (type === 'iri') {
                const iriRaw = getCellStr('iri');
                const prqiRaw = getCellStr('prqi');
                if (iriRaw && !isNaN(Number(iriRaw))) {
                  fileResults.push({
                    date: dateVal,
                    time: timeVal,
                    mileage: formatMileageIRI(mileageRaw),
                    route: routeVal,
                    direction: directionVal,
                    lane: laneVal,
                    avgIri: Number(iriRaw),
                    avgPrqi: Number(prqiRaw) || 0
                  });
                }
              } else if (type === 'sn') {
                const snRaw = getCellStr('sn');
                if (snRaw && !isNaN(Number(snRaw))) {
                  fileResults.push({
                    date: dateVal,
                    mileage: formatMileageSN(mileageRaw),
                    route: routeVal,
                    direction: directionVal,
                    lane: laneVal,
                    sn: Number(snRaw)
                  });
                }
              }
            } // end of block loop
          } // end of row loop
          });
          resolve(fileResults);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
    results.push(...fileData);
  }
  return results;
};
