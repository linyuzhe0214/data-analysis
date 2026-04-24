import * as XLSX from 'xlsx';

export interface RawIriData {
  time: string;
  mileage: string;
  route: string;
  direction: string;
  lane: string;
  avgIri: number;
  avgPrqi: number;
}

export interface RawSnData {
  time: string;
  mileage: string;
  direction: string;
  lane: string;
  sn: number;
}

// 將 166500 轉換為 166k+500
export const formatMileageIRI = (rawMileage: number | string): string => {
  const m = Number(rawMileage);
  if (isNaN(m)) return String(rawMileage);
  const km = Math.floor(m / 1000);
  const meter = m % 1000;
  return `${km}k+${meter.toString().padStart(3, '0')}`;
};

// 將 166+500 轉換為 166k+500
export const formatMileageSN = (rawMileage: string): string => {
  if (!rawMileage || typeof rawMileage !== 'string') return String(rawMileage);
  return rawMileage.replace('+', 'k+');
};

export const parseSNFile = async (file: File): Promise<RawSnData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        let globalTime = '';
        const results: RawSnData[] = [];

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          if (!row) continue;

          // 嘗試抓取測試日期 (ex: "測試日期 1140422下午06:00-10:00...")
          if (row[0] && typeof row[0] === 'string' && row[0].includes('測試日期')) {
            globalTime = row[0].replace('測試日期', '').trim();
          } else if (row[0] === '測試日期' && row[1]) {
            globalTime = String(row[1]).trim();
          }

          // 掃描每一列的所有欄位，尋找符合 SN 資料特徵的區塊 (測試里程, 測試車道, 抗滑值)
          for (let c = 0; c < row.length - 2; c++) {
            const cellA = String(row[c] || '').trim();
            const cellB = String(row[c + 1] || '').trim();
            const cellC = row[c + 2];

            // 里程格式大概長 "192+000"
            if (cellA.includes('+') && /^[NS]\d$/.test(cellB) && typeof cellC === 'number') {
              const directionCode = cellB.charAt(0).toUpperCase();
              let direction = '';
              if (directionCode === 'N') direction = '北上';
              else if (directionCode === 'S') direction = '南下';
              else if (directionCode === 'E') direction = '東向';
              else if (directionCode === 'W') direction = '西向';

              results.push({
                time: globalTime,
                mileage: formatMileageSN(cellA),
                direction: direction,
                lane: '第三車道', // 依據使用者需求：「SN 值只有第三車道」
                sn: cellC
              });
            }
          }
        }
        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

export const parseIRIFile = async (file: File): Promise<RawIriData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const results: RawIriData[] = [];

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          let route = '';
          let lane = '';
          let rawDirection = '';
          let headerRowIndex = -1;

          // 1. 掃描 Metadata 與 表頭位置
          for (let r = 0; r < Math.min(20, rows.length); r++) {
            const row = rows[r];
            if (!row) continue;
            
            const firstCell = String(row[0] || '').trim();
            if (firstCell.startsWith('路名:')) route = firstCell.replace('路名:', '').trim();
            if (firstCell.startsWith('車道:')) lane = firstCell.replace('車道:', '').split(' ')[0].trim();
            if (firstCell.startsWith('方向:')) {
                const parts = firstCell.replace('方向:', '').trim().split(' ');
                rawDirection = parts[0].trim();
            }

            // 尋找資料表頭
            const rowStr = row.map(c => String(c || '').trim()).join(',');
            if (rowStr.includes('結束里程') && rowStr.includes('平均IRI') && rowStr.includes('平均PRQI')) {
              headerRowIndex = r;
              break;
            }
          }

          if (headerRowIndex === -1) return; // 找不到表頭則跳過此 Sheet

          // 轉換方向：逆樁/順樁 -> 北上/南下/東向/西向
          let direction = rawDirection;
          if (rawDirection.includes('逆樁')) {
            direction = (route.includes('4')) ? '西向' : '北上';
          } else if (rawDirection.includes('順樁')) {
            direction = (route.includes('4')) ? '東向' : '南下';
          }

          // 尋找特定欄位的 Index
          const headers = rows[headerRowIndex].map(h => String(h || '').trim());
          const timeIdx = headers.findIndex(h => h === '日期時間');
          const mileageIdx = headers.findIndex(h => h === '結束里程');
          const avgIriIdx = headers.findIndex(h => h === '平均IRI');
          const avgPrqiIdx = headers.findIndex(h => h === '平均PRQI');

          if (mileageIdx === -1 || avgIriIdx === -1 || avgPrqiIdx === -1) return;

          // 2. 擷取資料
          for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            const mileageVal = row[mileageIdx];
            const avgIriVal = row[avgIriIdx];
            const avgPrqiVal = row[avgPrqiIdx];

            if (typeof mileageVal === 'number' && typeof avgIriVal === 'number' && typeof avgPrqiVal === 'number') {
              const timeVal = timeIdx !== -1 && row[timeIdx] ? String(row[timeIdx]) : '';
              results.push({
                time: timeVal,
                mileage: formatMileageIRI(mileageVal),
                route,
                direction,
                lane,
                avgIri: avgIriVal,
                avgPrqi: avgPrqiVal
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
