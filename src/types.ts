export interface PavementData {
  date: string;
  route: string;
  direction: string;
  lane: string;
  mileage: number;
  iri: number; // International Roughness Index
  sn: number;  // Skid Number
  prqi: number; // Pavement Roughness Quality Index
}

export type IriCondition = 'level1' | 'level2' | 'level3' | 'level4' | 'level5' | 'level6';
export type SnCondition = 'good' | 'fair' | 'poor';
export type PrqiCondition = 'good' | 'fair' | 'poor';

export const getIriCondition = (iri: number): IriCondition => {
  if (iri <= 1.0) return 'level1';
  if (iri <= 1.3) return 'level2';
  if (iri <= 1.75) return 'level3';
  if (iri <= 2.0) return 'level4';
  if (iri <= 2.5) return 'level5';
  return 'level6';
};

export const getSnCondition = (sn: number): SnCondition => {
  if (sn >= 50) return 'good';
  if (sn >= 40) return 'fair';
  return 'poor';
};

export const getPrqiCondition = (prqi: number): PrqiCondition => {
  if (prqi < 0.2) return 'good';
  if (prqi <= 0.3) return 'fair';
  return 'poor';
};

export const getIriColor = (iri: number) => {
  const condition = getIriCondition(iri);
  if (condition === 'level1') return 'bg-blue-500';
  if (condition === 'level2') return 'bg-green-500';
  if (condition === 'level3') return 'bg-yellow-400';
  if (condition === 'level4') return 'bg-orange-400';
  if (condition === 'level5') return 'bg-orange-600';
  return 'bg-red-600';
};

export const getSnColor = (sn: number) => {
  const condition = getSnCondition(sn);
  if (condition === 'good') return 'bg-green-500';
  if (condition === 'fair') return 'bg-yellow-400';
  return 'bg-red-500';
};

export const getPrqiColor = (prqi: number) => {
  const condition = getPrqiCondition(prqi);
  if (condition === 'good') return 'bg-green-500';
  if (condition === 'fair') return 'bg-yellow-400';
  return 'bg-red-500';
};

const CHINESE_DIGITS: Record<string, string> = {
  '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
  '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
};

export const normalizeRouteName = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/(?:國道?|國|F|Freeway)\s*([0-9一二三四五六七八九十]+)\s*號?/i);
  if (m) {
    const digit = CHINESE_DIGITS[m[1]] ?? m[1];
    return `國道${digit}號`;
  }
  return s;
};

export const normalizeDirection = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.includes('南') || s === 'S') return '南下';
  if (s.includes('北') || s === 'N') return '北上';
  if (s.includes('東') || s === 'E') return '東向';
  if (s.includes('西') || s === 'W') return '西向';
  return s;
};

