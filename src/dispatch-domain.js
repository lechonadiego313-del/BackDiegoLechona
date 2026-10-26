const moneyPattern = /^\d{1,12}(\.\d{1,2})?$/;

export function moneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!moneyPattern.test(text)) return null;
  const [whole, decimals = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}

export function totalUnitCostCents(productionCost, indirectPercentage) {
  const cost = moneyToCents(productionCost);
  const percentage = Number(indirectPercentage);
  if (cost == null || !Number.isFinite(percentage) || percentage < 0 || percentage > 1000) return null;
  return Math.round(cost * (1 + percentage / 100));
}

export function validateDispatchInput(body) {
  if (!body || !["retail", "wholesale"].includes(body.saleType)) return "Sale type must be retail or wholesale.";
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) return "At least one item is required.";
  if (!String(body.idempotencyKey || "").match(/^[A-Za-z0-9_-]{12,80}$/)) return "A valid idempotency key is required.";
  for (const item of body.items) {
    if (!item || typeof item.presentationId !== "string" || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 10000) {
      return "Every item requires a valid presentation and quantity.";
    }
  }
  return "";
}

export function periodRange(period, reference) {
  if (!["day", "week", "month", "year"].includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(reference || "")) return null;
  const start = new Date(`${reference}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== reference) return null;
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  if (period === "year") start.setUTCMonth(0, 1);
  const end = new Date(start);
  if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start, end };
}
