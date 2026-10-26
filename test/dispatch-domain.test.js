import test from "node:test";
import assert from "node:assert/strict";
import { centsToMoney, moneyToCents, periodRange, totalUnitCostCents, validateDispatchInput } from "../src/dispatch-domain.js";

test("money conversion rejects unsafe values and preserves two decimals", () => {
  assert.equal(moneyToCents("12500.50"), 1250050);
  assert.equal(centsToMoney(1250050), "12500.50");
  assert.equal(moneyToCents("-1"), null);
  assert.equal(moneyToCents("1.234"), null);
});

test("unit cost applies indirect percentage with cent rounding", () => {
  assert.equal(totalUnitCostCents("6500", "22"), 793000);
  assert.equal(totalUnitCostCents("10.01", "22.5"), 1226);
});

test("dispatch input requires a durable idempotency key and valid quantities", () => {
  const valid = { saleType: "retail", idempotencyKey: "dispatch_123456", items: [{ presentationId: "p1", quantity: 2 }] };
  assert.equal(validateDispatchInput(valid), "");
  assert.match(validateDispatchInput({ ...valid, items: [] }), /item/i);
  assert.match(validateDispatchInput({ ...valid, items: [{ presentationId: "p1", quantity: 0 }] }), /quantity/i);
});

test("period ranges follow ISO day, Monday week, month and year boundaries", () => {
  assert.deepEqual(Object.values(periodRange("week", "2026-10-26")).map((date) => date.toISOString()), ["2026-10-26T00:00:00.000Z", "2026-11-02T00:00:00.000Z"]);
  assert.deepEqual(Object.values(periodRange("month", "2026-10-26")).map((date) => date.toISOString()), ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  assert.equal(periodRange("quarter", "2026-10-26"), null);
});
