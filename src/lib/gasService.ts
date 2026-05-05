/// <reference types="vite/client" />
import { RawSnData, RawIriData } from './excelParser';

// 統一從環境變數讀取 GAS 網址，不管是開發還是正式環境都直連 GAS
export const GAS_URL: string = import.meta.env.VITE_GAS_URL || '';

interface UploadResult {
  success: boolean;
  inserted?: number;
  error?: string;
}

/** 將物件陣列序列化為 CSV 字串（header + rows） */
function toCsv(headers: string[], records: Record<string, any>[]): string {
  const escape = (v: any) => {
    const s = String(v ?? '');
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map(r => headers.map(h => escape(r[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

/**
 * 通用 POST helper。
 * 使用 no-cors mode：不觸發 preflight，不受 GAS 302 redirect 影響。
 * 代價是無法讀回 response body，改由呼叫端自行計算 inserted 數量。
 */
async function postCsv(url: string, csv: string): Promise<void> {
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',           // 避開 CORS / redirect 問題
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: csv,
  });
  // no-cors 回傳 opaque response，無法判斷成功與否，視為已送出
}

export const uploadSNData = async (records: RawSnData[]): Promise<UploadResult> => {
  if (!GAS_URL) return { success: false, error: 'GAS URL 未設定' };
  const SN_HEADERS = ['date', 'route', 'direction', 'lane', 'mileage', 'sn', 'batchName'];
  await postCsv(`${GAS_URL}?type=sn`, toCsv(SN_HEADERS, records));
  return { success: true, inserted: records.length };
};

export const uploadIRIData = async (records: RawIriData[]): Promise<UploadResult> => {
  if (!GAS_URL) return { success: false, error: 'GAS URL 未設定' };
  const IRI_HEADERS = ['date', 'time', 'route', 'direction', 'lane', 'mileage', 'avgIri', 'avgPrqi', 'batchName'];
  await postCsv(`${GAS_URL}?type=iri`, toCsv(IRI_HEADERS, records));
  return { success: true, inserted: records.length };
};

export const fetchSNData = async (): Promise<RawSnData[]> => {
  if (!GAS_URL) throw new Error('GAS URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=sn`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawSnData[];
};

export const fetchIRIData = async (): Promise<RawIriData[]> => {
  if (!GAS_URL) throw new Error('GAS URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=iri`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawIriData[];
};
