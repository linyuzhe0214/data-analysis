import * as XLSX from 'xlsx';

export interface RawIriData {
  date: string;      // YYYY-MM-DD
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

/** 從任意字串抽取「國道X號」 */
const extractHighway = (text: string): string => {
  const m = text.match(/國道\d+號/);
  return m ? m[0] : '';
};

/** 民國日期 "1140422..." → "2025-04-22"，或直接傳西元日期字串回傳 */
const convertROCDate = (input: string): string => {
  const m = input.match(/^(\d{7})/);
  if (!m) return input;
  const digits = m[1];
  const rocYear = parseInt(digits.slice(0, 3), 10);
  const month   = digits.slice(3, 5);
  const day     = digits.slice(5, 7);
  return `${rocYear + 1911}-${month}-${day}`;
};

/** 統一把各種日期值轉成 "YYYY-MM-DD"（處理 JS Date / ISO string / 純日期字串） */
const normalizeDateValue = (val: unknown): string => {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const s = String(val);
  if (s.includes('T')) return s.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
};

/** 將 166500 轉換為 166k+500（IRI 里程格式） */
export const formatMileageIRI = (rawMileage: number | string): string => {
  const m = Number(rawMileage);
  if (isNaN(m)) return String(rawMileage);
  const km    = Math.floor(m / 1000);
  const meter = m % 1000;
  return `${km}k+${meter.toString().padStart(3, '0')}`;
};

/** 將 166+500 轉換為 166k+500（SN 里程格式） */
export const formatMileageSN = (rawMileage: string): string => {
  if (!rawMileage || typeof rawMileage !== 'string') return String(rawMileage);
  return rawMileage.replace('+', 'k+');
};

/** 順樁/逆樁 × 國道 → 方向 */
const resolveDirection = (raw: string, highway: string): string => {
  const isRoute4 = highway.includes('4');
  if (raw.includes('逆樁')) return isRoute4 ? '西向' : '北上';
  if (raw.includes('順樁')) return isRoute4 ? '東向' : '南下';
  return raw; // 直接回傳（已是北上/南下等）
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
  const laneMatch = sheetName.match(/第[一二三四五六七八九十百]+車道/);
  const lane  = laneMatch ? laneMatch[0] : '';
  const route = extractHighway(sheetName);
  const directionRaw = sheetName.includes('逆樁') ? '逆樁'
                     : sheetName.includes('順樁') ? '順樁'
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
          let globalDate = sheetDateConverted !== sheetName.trim() ? sheetDateConverted : '';
          let globalRoute = '';

          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;

            // Row 1：公路編號 → 抽取國道別
            if (r === 0) {
              const fullText = row.map(String).join(' ');
              globalRoute = extractHighway(fullText);
            }

            // 測試日期 → 轉換民國日期
            for (let c = 0; c < row.length; c++) {
              const cell = String(row[c] || '').trim();
              if (cell === '測試日期' && row[c + 1]) {
                globalDate = convertROCDate(String(row[c + 1]).trim());
              } else if (cell.includes('測試日期') && cell.length > 4) {
                const dateStr = cell.replace('測試日期', '').trim();
                globalDate = convertROCDate(dateStr);
              }
            }

            // 掃描資料欄：里程 + 車道代碼 + 抗滑值
            for (let c = 0; c < row.length - 2; c++) {
              const cellA = String(row[c]     || '').trim(); // 里程 192+000
              const cellB = String(row[c + 1] || '').trim(); // 車道代碼 N3
              const cellC = row[c + 2];                       // 抗滑值

              // 里程格式 + 車道代碼（字母+數字）+ 數值
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
        // cellDates:true → Excel 日期欄位轉為 JS Date，而非 serial number
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const results: RawIriData[] = [];

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          // 先從 sheet 名稱解析路線/車道/方向（優先）
          const fromSheetName = parseIriSheetName(sheetName);
          let route        = fromSheetName.route;
          let lane         = fromSheetName.lane;
          let directionRaw = fromSheetName.directionRaw;
          let headerRowIndex = -1;

          // 掃描前 20 列，補充 cell 中的 metadata（sheet 名稱沒有才用）
          for (let r = 0; r < Math.min(20, rows.length); r++) {
            const row = rows[r];
            if (!row) continue;

            const firstCell = String(row[0] || '').trim();

            if (!route && firstCell.startsWith('路名:')) {
              route = extractHighway(firstCell.replace('路名:', '').trim()) || firstCell.replace('路名:', '').trim();
            }
            if (!lane && firstCell.startsWith('車道:')) {
              lane = firstCell.replace('車道:', '').split(' ')[0].trim();
            }
            if (!directionRaw && firstCell.startsWith('方向:')) {
              directionRaw = firstCell.replace('方向:', '').trim().split(' ')[0].trim();
            }

            const rowStr = row.map(c => String(c || '').trim()).join(',');
            if (rowStr.includes('結束里程') && rowStr.includes('平均IRI')) {
              headerRowIndex = r;
              break;
            }
          }

          if (headerRowIndex === -1) return;

          const direction = resolveDirection(directionRaw, route);

          // 找欄位 index
          const headers     = rows[headerRowIndex].map(h => String(h || '').trim());
          const timeIdx     = headers.findIndex(h => h === '日期時間');
          const mileageIdx  = headers.findIndex(h => h === '結束里程');
          const avgIriIdx   = headers.findIndex(h => h === '平均IRI');
          const avgPrqiIdx  = headers.findIndex(h => h.includes('PRQI') || h.includes('PRQ'));

          if (mileageIdx === -1 || avgIriIdx === -1) return;

          for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            const mileageVal  = row[mileageIdx];
            const avgIriVal   = row[avgIriIdx];
            const avgPrqiVal  = avgPrqiIdx !== -1 ? row[avgPrqiIdx] : 0;

            if (!isNaN(Number(mileageVal)) && !isNaN(Number(avgIriVal))) {
              const rawTime = timeIdx !== -1 ? row[timeIdx] : null;
              results.push({
                date:      normalizeDateValue(rawTime),
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
