export interface PavementData {
  year: number;
  route: string;
  direction: string;
  lane: string;
  mileage: number;
  iri: number; // International Roughness Index
  sn: number;  // Skid Number
}

export type IriCondition = 'level1' | 'level2' | 'level3' | 'level4' | 'level5';
export type SnCondition = 'good' | 'fair' | 'poor';

export const getIriCondition = (iri: number): IriCondition => {
  if (iri <= 1.0) return 'level1';
  if (iri <= 1.3) return 'level2';
  if (iri <= 1.75) return 'level3';
  if (iri < 2.0) return 'level4';
  return 'level5';
};

export const getSnCondition = (sn: number): SnCondition => {
  if (sn >= 50) return 'good';
  if (sn >= 40) return 'fair';
  return 'poor';
};

export const getIriColor = (iri: number) => {
  const condition = getIriCondition(iri);
  if (condition === 'level1') return 'bg-blue-500';
  if (condition === 'level2') return 'bg-green-500';
  if (condition === 'level3') return 'bg-yellow-400';
  if (condition === 'level4') return 'bg-orange-500';
  return 'bg-red-600';
};

export const getSnColor = (sn: number) => {
  const condition = getSnCondition(sn);
  if (condition === 'good') return 'bg-green-500';
  if (condition === 'fair') return 'bg-yellow-400';
  return 'bg-red-500';
};
