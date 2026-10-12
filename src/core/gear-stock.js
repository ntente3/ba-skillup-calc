/** Allocate shared tier selectors once, after ordinary gear stock.
 * Requirements use inventory keys (eq.<type>.<tier>). Within each tier,
 * shortage coverage is proportional to the original on-hand gear counts.
 * Capped shares are redistributed; all-zero weights fall back to equal shares.
 * Largest remainders round to whole blueprints, with type order breaking ties.
 */
export function allocateGear(required, inv) {
  const selected = {}, selectors = {}, debit = {}, tiers = new Map();
  const entries = Object.entries(required).sort(([a], [b]) => {
    const [, at, ar] = a.split(".");
    const [, bt, br] = b.split(".");
    return Number(ar) - Number(br) || Number(at) - Number(bt);
  });
  for (const [key, qty] of entries) {
    const selector = `eq-select.${key.split(".")[2]}`;
    const count = Number(inv[key]);
    const weight = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    const short = Math.max(0, qty - weight);
    debit[key] = qty;
    if (!short) continue;
    if (!tiers.has(selector)) tiers.set(selector, []);
    tiers.get(selector).push({ key, weight, short });
  }
  const assign = (selector, item, use) => {
    if (!use) return;
    selected[item.key] = (selected[item.key] || 0) + use;
    selectors[selector] = (selectors[selector] || 0) + use;
    debit[item.key] -= use;
  };
  for (const [selector, items] of tiers) {
    const count = Number(inv[selector]);
    let budget = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    budget = Math.min(budget, items.reduce((sum, item) => sum + item.short, 0));
    let active = items;
    while (budget > 0 && active.length) {
      const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
      const shares = active.map((item) => ({
        ...item, share: budget * (totalWeight ? item.weight / totalWeight : 1 / active.length),
      }));
      const capped = shares.filter((item) => item.share >= item.short);
      if (capped.length) {
        for (const item of capped) {
          assign(selector, item, item.short);
          budget -= item.short;
        }
        const cappedKeys = new Set(capped.map((item) => item.key));
        active = active.filter((item) => !cappedKeys.has(item.key));
        continue;
      }
      let remainder = budget;
      for (const item of shares) {
        const use = Math.floor(item.share);
        assign(selector, item, use);
        remainder -= use;
      }
      shares.sort((a, b) =>
        (b.share % 1) - (a.share % 1) || Number(a.key.split(".")[1]) - Number(b.key.split(".")[1]));
      for (let i = 0; i < remainder; i++) assign(selector, shares[i], 1);
      budget = 0;
    }
  }
  return { selected, selectors, debit };
}
