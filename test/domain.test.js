import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecord, parsePagination, recordDateMatchesMonth, traceRecordsSql, validMonth, validateFormat } from "../src/domain.js";

test("validMonth accepts only valid YYYY-MM values", () => {
  assert.equal(validMonth("2026-10"), true);
  assert.equal(validMonth("2026-13"), false);
  assert.equal(validMonth("2026-2"), false);
});

test("record dates must be real dates inside the selected month", () => {
  assert.equal(recordDateMatchesMonth("2026-10-31", "2026-10"), true);
  assert.equal(recordDateMatchesMonth("2026-11-01", "2026-10"), false);
  assert.equal(recordDateMatchesMonth("2026-02-30", "2026-02"), false);
});

test("evaluateRecord marks out-of-range numbers and negative checks", () => {
  const format = {
    fields: [
      { n: "Temperatura", t: "num", u: "°C", min: 0, max: 4 },
      { n: "Empaque íntegro", t: "chk" },
    ],
  };
  assert.deepEqual(evaluateRecord(format, { Temperatura: "5", "Empaque íntegro": "No" }), [
    "Temperatura: 5 °C fuera de rango [0 a 4]",
    "Empaque íntegro: No conforme",
  ]);
  assert.deepEqual(evaluateRecord(format, { Temperatura: "4", "Empaque íntegro": "Sí" }), []);
});

test("evaluateRecord supports equipment ranges and Cumple / No cumple fields", () => {
  const format = { fields: [
    { n: "Temperatura", t: "num", u: "°C", min: 0, max: 4 },
    { n: "Condición", t: "cumple" },
  ] };
  assert.deepEqual(evaluateRecord(format, { Temperatura: "-10", Condición: "No cumple" }, {
    Temperatura: { min: -20, max: -15, label: "Cava 1 (Congelación)" },
  }), [
    "Temperatura: -10 °C fuera de rango para Cava 1 (Congelación) [-20 a -15]",
    "Condición: No cumple",
  ]);
});

test("validateFormat rejects reversed numeric limits", () => {
  assert.match(validateFormat({
    name: "Temperatura",
    freq: "Diario",
    fields: [{ n: "Lectura", t: "num", min: 5, max: 2 }],
  }), /límites numéricos/);
  assert.equal(validateFormat({
    name: "Temperatura",
    freq: "Diario",
    fields: [{ n: "Lectura", t: "num", min: 2, max: 5 }],
  }), "");
});

test("validateFormat accepts every fixed master field exposed by the frontend", () => {
  assert.equal(validateFormat({
    name: "POES",
    freq: "Diario",
    fields: [
      { n: "Responsable", t: "responsable" },
      { n: "Superficie", t: "superficie" },
      { n: "Utensilio", t: "utensilio" },
      { n: "Tipo de plaga", t: "tipo_plaga" },
    ],
  }), "");
});

test("parsePagination enforces bounded one-based pagination", () => {
  assert.deepEqual(parsePagination({ page: "3", limit: "10" }), {
    error: "",
    pagination: { page: 3, pageSize: 10, offset: 20 },
  });
  assert.deepEqual(parsePagination({}), { error: "", pagination: null });
  assert.match(parsePagination({ page: "0" }).error, /página/);
  assert.match(parsePagination({ limit: "101" }).error, /límite/);
});

test("trace query performs exact case-insensitive JSON value matching in PostgreSQL", () => {
  const sql = traceRecordsSql();
  assert.match(sql, /jsonb_each_text/);
  assert.match(sql, /lower\(field\.value\) = lower\(\$lot\)/);
  assert.match(sql, /WHERE EXISTS/);
  assert.match(sql, /\$lot/);
  assert.doesNotMatch(sql, /ILIKE|%/);
});
