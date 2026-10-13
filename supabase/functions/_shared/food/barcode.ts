// Barcode validation: EAN-13, UPC-A (12 digits) and EAN-8, with the GS1 check digit.
// Kept identical to the app's src/food/barcode.ts (a test checks they agree).
export function isValidBarcode(code: unknown): boolean {
  if (typeof code !== 'string' || !/^\d+$/.test(code)) return false;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  // From the right (after the check digit) the weights alternate 3, 1, 3, ...
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Open Food Facts stores UPC-A as a 13 digit code with a leading zero.
export function toLookupCode(code: string): string {
  return code.length === 12 ? `0${code}` : code;
}
