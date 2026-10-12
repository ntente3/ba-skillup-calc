/** Allocate shared tier selectors once, after ordinary gear stock.
 * Requirements use inventory keys (eq.<type>.<tier>). Stable type order
 * makes the preview and debit agree. One selector supplies one blueprint.
 */
export function allocateGear(required, inv) {
  const selected = {}, selectors = {}, debit = {}, available = {};
  const entries = Object.entries(required).sort(([a], [b]) => {
    const [, at, ar] = a.split(".");
    const [, bt, br] = b.split(".");
    return Number(ar) - Number(br) || Number(at) - Number(bt);
  });
  for (const [key, qty] of entries) {
    const selector = `eq-select.${key.split(".")[2]}`;
    if (!(selector in available)) {
      const count = Number(inv[selector]);
      available[selector] = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    }
    const short = Math.max(0, qty - Math.max(0, inv[key] || 0));
    const use = Math.min(short, available[selector]);
    if (use) {
      selected[key] = use;
      selectors[selector] = (selectors[selector] || 0) + use;
      available[selector] -= use;
    }
    debit[key] = qty - use;
  }
  return { selected, selectors, debit };
}
