/// <reference types="vite/client" />
import { RawSnData, RawIriData } from './excelParser';

const GAS_URL = import.meta.env.VITE_GAS_URL ?? '';

interface UploadResult {
  success: boolean;
  inserted?: number;
  error?: string;
}

/** 將物件陣列序列化為 CSV 字串（header + rows） */
function toCsv(headers: string[], records: Record<string, any>[]): string {
  const escape = (v: any) => {
    const s = String(v ?? '');
    // 有逗號、雙引號或換行時加引號
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map(r => headers.map(h => escape(r[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export const uploadSNData = async (records: RawSnData[]): Promise<UploadResult> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const SN_HEADERS = ['date', 'route', 'direction', 'lane', 'mileage', 'sn'];
  const res = await fetch(`${GAS_URL}?type=sn`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: toCsv(SN_HEADERS, records),
  });
  return res.json();
};

export const uploadIRIData = async (records: RawIriData[]): Promise<UploadResult> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const IRI_HEADERS = ['date', 'time', 'route', 'direction', 'lane', 'mileage', 'avgIri', 'avgPrqi'];
  const res = await fetch(`${GAS_URL}?type=iri`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: toCsv(IRI_HEADERS, records),
  });
  return res.json();
};

export const fetchSNData = async (): Promise<RawSnData[]> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=sn`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawSnData[];
};

export const fetchIRIData = async (): Promise<RawIriData[]> => {
  if (!GAS_URL) throw new Error('VITE_GAS_URL 未設定');
  const res  = await fetch(`${GAS_URL}?type=iri`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data as RawIriData[];
};
