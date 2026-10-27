// Preserve historically disabled behavior unless a positive limit is explicitly configured.
export function loopGuardMax(value) {
  if (value === undefined || value === null) return 0;
  if (!/^\d+$/.test(String(value))) return 256;
  const max = Number(value);
  return Number.isSafeInteger(max) ? max : 256;
}
