/// <reference types="vite/client" />
import { RawSnData, RawIriData } from './excelParser';

// ← 部署後填入你的 GAS Web App URL
const GAS_URL = import.meta.env.VITE_GAS_URL ?? '';

interface UploadResult {
  success: boolean;
  inserted?: number;
  error?: string;
}

/**
 * 將解析完的 SN 資料上傳至 GAS 資料庫
 */
export const uploadSNData = async (records: RawSnData[]): Promise<UploadResult> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ type: 'sn', records }),
  });
  return res.json();
};

/**
 * 將解析完的 IRI 資料上傳至 GAS 資料庫
 */
export const uploadIRIData = async (records: RawIriData[]): Promise<UploadResult> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ type: 'iri', records }),
  });
  return res.json();
};

/**
 * 從 GAS 讀取 SN 資料
 */
export const fetchSNData = async (): Promise<RawSnData[]> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=sn`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawSnData[];
};

/**
 * 從 GAS 讀取 IRI 資料
 */
export const fetchIRIData = async (): Promise<RawIriData[]> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=iri`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawIriData[];
};
