import * as XLSX from 'xlsx';
import { PavementData } from '../types';

export interface ExportManualValues {
  unit: string;
  personnel: string;
  weather: string;
  tmp: string;
  atmp: string;
  description: string;
  isAssessment: string;
}

/**
 * 里程轉換為公尺整數：
 *   - 字串 "11k+000" → 11000
 *   - 字串 "11+000"  → 11000
 *   - 數字 11.0 (km) → 11000
 *   - 數字 166.5     → 166500
 */
const mileageToMeters = (km: number | string): number => {
  if (typeof km === 'string') {
    // 解析 "166k+500" 或 "166+500"
    const m = km.match(/(\d+)[kK]?\+(\d+)/);
    if (m) return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10);
    // 純數字字串
    return Math.round(parseFloat(km) * 1000);
  }
  // 若已是公尺級別（>1000），直接 round
  if (km > 1000) return Math.round(km);
  // km 浮點數 → 公尺，用字串轉換避免 floating point 誤差
  return Math.round(parseFloat((km * 1000).toFixed(3)));
};


/** 西元年 → 民國年，例如 '2022-06-30' → 111 */
const toROCYear = (dateStr: string): number => {
  const y = parseInt(dateStr.slice(0, 4), 10);
  return y - 1911;
};

/** 方向對應 */
const toDirection = (d: string): string => {
  if (d === '南下' || d === '東向') return '順向';
  if (d === '北上' || d === '西向') return '逆向';
  return d;
};

/** 路線名稱轉換：'國道1號' → '國1' */
const toRouteCode = (route: string): string =>
  route.replace('國道', '國').replace('號', '');

/** 車道格式轉換：'第一車道' → '第1車道' */
const toLaneName = (lane: string): string =>
  lane
    .replace('第一車道', '第1車道')
    .replace('第二車道', '第2車道')
    .replace('第三車道', '第3車道')
    .replace('第四車道', '第4車道')
    .replace('第五車道', '第5車道')
    .replace('第六車道', '第6車道');

export const generateExportExcel = (
  data: PavementData[],
  category: 'IRI' | 'SN' | 'PRQI',
  manualValues: ExportManualValues,
  fileName: string = 'export.xlsx'
) => {
  const valueColName =
    category === 'IRI' ? 'IRI值' : category === 'SN' ? 'SN值' : 'PRQI值';

  // 第 1 列：欄位名稱
  const headers = [
    '國道名稱', '類型', '車行方向', '里程', '車道別',
    valueColName, '檢測年份', '檢測日期',
    '檢測單位', '檢測人員', '天氣', 'TMP', 'ATMP', '資料說明', '是否為考評用'
  ];

  const rows: any[][] = [headers];

  // 第 2 列起：資料
  data.forEach((d) => {
    const value = category === 'IRI' ? d.iri : category === 'SN' ? d.sn : d.prqi;
    rows.push([
      toRouteCode(d.route),
      'main',
      toDirection(d.direction),
      mileageToMeters(d.mileage),
      toLaneName(d.lane),
      Number(value.toFixed(3)),
      toROCYear(d.date),
      d.date,
      manualValues.unit,
      manualValues.personnel,
      manualValues.weather,
      Number(manualValues.tmp) || 0,
      Number(manualValues.atmp) || 0,
      manualValues.description,
      manualValues.isAssessment,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, fileName, { bookType: 'xlsx', compression: true });
};
