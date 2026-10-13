const DECIMAL_PATTERN = /^(\d+[.,]?\d*|[.,]\d+)$/;
const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

export function parseDecimal(input: string): number | null {
  const trimmed = input.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  return Number(trimmed.replace(',', '.'));
}

export function kgFromLb(lb: number): number {
  return lb * KG_PER_LB;
}

export function cmFromFtIn(ft: number, inches: number): number {
  return (ft * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

export function lbFromKg(kg: number): number {
  return kg / KG_PER_LB;
}

export function ftInFromCm(cm: number): { ft: number; inches: number } {
  const totalInches = Math.round((cm / CM_PER_INCH) * 10) / 10;
  const ft = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = Math.round((totalInches - ft * INCHES_PER_FOOT) * 10) / 10;
  return { ft, inches };
}
