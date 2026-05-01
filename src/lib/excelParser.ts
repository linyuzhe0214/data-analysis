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
  if (val instanceof Date) {
    const iso = val.toISOString(); // UTC
    // Excel 日期通常直接是當地時間，不做 timezone 轉換
    const [datePart, timePart] = iso.split('T');
    return {
      date: datePart,
      time: timePart?.split('.')[0] ?? '',
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

  // 純西元日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: '' };

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
  if (raw.includes('逆樁') || raw === '北上') return isRoute4 ? '西向' : '北上';
  if (raw.includes('順樁') || raw === '南下') return isRoute4 ? '東向' : '南下';
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
  const laneMatch = sheetName.match(/第[一二三四五六七八九十百\d]+車道/);
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
