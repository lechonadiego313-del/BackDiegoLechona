const frequencies = new Set(["Diario", "Semanal", "Quincenal", "Mensual", "Por evento"]);
const fieldTypes = new Set(["num", "txt", "date", "time", "sel", "chk", "cumple", "producto", "area", "punto", "proveedor", "cliente", "equipo", "responsable", "superficie", "utensilio", "tipo_plaga", "lote"]);

export function validateRecordValues(format, values) {
  for (const field of format.fields) {
    const value = values[field.n];
    if (field.t === "num" && value !== "" && value != null && !Number.isFinite(Number(value))) {
      return "Cada campo numérico debe contener un número válido.";
    }
    if (field.t === "time" && value !== "" && value != null &&
        (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      return `La hora de "${field.n}" debe tener el formato HH:mm.`;
    }
  }
  return "";
}

export function evaluateRecord(format, values, dynamicRanges = {}) {
  const deviations = [];
  for (const field of format.fields) {
    const value = values[field.n];
    if (field.t === "num" && value !== "" && value != null && Number.isFinite(Number(value))) {
      const number = Number(value);
      const range = dynamicRanges[field.n] || field;
      if ((range.min !== "" && range.min != null && number < Number(range.min)) ||
          (range.max !== "" && range.max != null && number > Number(range.max))) {
        const source = range.label ? ` para ${range.label}` : "";
        deviations.push(`${field.n}: ${value}${field.u ? ` ${field.u}` : ""} fuera de rango${source} [${range.min ?? "–"} a ${range.max ?? "–"}]`);
      }
    }
    if (field.t === "chk" && value === "No") deviations.push(`${field.n}: No conforme`);
    if (field.t === "cumple" && value === "No cumple") deviations.push(`${field.n}: No cumple`);
  }
  return deviations;
}

export function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function recordDateMatchesMonth(date, month) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validMonth(month) || date.slice(0, 7) !== month) return false;
  const value = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function validateFormat({ name, freq, fields, config = {} }) {
  if (!String(name || "").trim() || !Array.isArray(fields) || fields.length === 0) {
    return "El formato requiere nombre y al menos un campo.";
  }
  if (!frequencies.has(freq)) return "La frecuencia indicada no es válida.";
  if (!config || typeof config !== "object" || Array.isArray(config)) return "La configuración del formato no es válida.";
  const bulkMode = config.bulkMode || "none";
  if (!new Set(["none", "personnel", "surfaces"]).has(bulkMode)) return "El modo de registro masivo no es válido.";
  if (bulkMode === "surfaces" && !new Set(["Cumple", "No cumple"]).has(config.defaultResult || "Cumple")) {
    return "El resultado inicial del registro masivo no es válido.";
  }
  const timedFieldNames = new Set();
  for (const field of fields) {
    if (!field || !String(field.n || "").trim() || !fieldTypes.has(field.t)) {
      return "Todos los campos deben tener un nombre y un tipo válido.";
    }
    if (field.includeTime != null && typeof field.includeTime !== "boolean") {
      return `La configuración de hora de "${field.n}" no es válida.`;
    }
    if (field.timeRequired != null && typeof field.timeRequired !== "boolean") {
      return `La obligatoriedad de hora de "${field.n}" no es válida.`;
    }
    if (field.includeTime && field.t !== "cumple") {
      return `Solo los campos "Cumple / No cumple" pueden tener una hora asociada.`;
    }
    if (field.timeRequired && !field.includeTime) {
      return `La hora obligatoria de "${field.n}" debe estar habilitada.`;
    }
    if (field.includeTime && timedFieldNames.has(field.n)) {
      return `Los campos con hora deben tener nombres únicos: "${field.n}".`;
    }
    if (field.includeTime) timedFieldNames.add(field.n);
    if (field.t === "num") {
      const min = field.min === "" || field.min == null ? null : Number(field.min);
      const max = field.max === "" || field.max == null ? null : Number(field.max);
      if ((min !== null && !Number.isFinite(min)) ||
          (max !== null && !Number.isFinite(max)) ||
          (min !== null && max !== null && min > max)) {
        return `Los límites numéricos de "${field.n}" no son válidos.`;
      }
    }
  }
  return "";
}

export function validateBulkValues(format, values) {
  const mode = format.config?.bulkMode || "none";
  if (mode === "none") return "";
  const bulk = values?.__bulk;
  if (!bulk || typeof bulk !== "object" || Array.isArray(bulk) || bulk.mode !== mode || !Array.isArray(bulk.items)) {
    return "Los resultados del registro masivo no son válidos.";
  }
  if (!bulk.items.length) return mode === "personnel" ? "Selecciona al menos una persona que haya asistido." : "No hay superficies para revisar.";
  const ids = new Set();
  const criteria = format.fields.filter((field) => field.t === "cumple");
  if (mode === "personnel" && !criteria.length) return "El formato BPM requiere al menos un criterio Cumple / No cumple.";
  for (const item of bulk.items) {
    if (!item || typeof item.masterId !== "string" || !item.masterId || ids.has(item.masterId)) return "Los elementos del registro masivo deben ser únicos y válidos.";
    ids.add(item.masterId);
    if (mode === "surfaces") {
      if (!new Set(["Cumple", "No cumple"]).has(item.result)) return "Cada superficie debe tener un resultado Cumple / No cumple.";
      continue;
    }
    if (!item.results || typeof item.results !== "object" || Array.isArray(item.results)) return "Los resultados por persona no son válidos.";
    for (const field of criteria) {
      if (!new Set(["Cumple", "No cumple"]).has(item.results[field.n])) return `Completa "${field.n}" para cada persona seleccionada.`;
    }
  }
  return "";
}

export function evaluateBulkRecord(format, values) {
  const mode = format.config?.bulkMode || "none";
  const items = values?.__bulk?.items || [];
  if (mode === "surfaces") {
    return items.filter((item) => item.result === "No cumple").map((item) => `${item.masterName}: No cumple`);
  }
  if (mode === "personnel") {
    const deviations = [];
    for (const item of items) {
      for (const [criterion, result] of Object.entries(item.results || {})) {
        if (result === "No cumple") deviations.push(`${item.masterName} · ${criterion}: No cumple`);
      }
    }
    return deviations;
  }
  return [];
}

export function validateRecordTimes(format, times) {
  if (!times || typeof times !== "object" || Array.isArray(times)) {
    return "Las horas del registro deben enviarse como un objeto.";
  }
  const configuredFields = new Set(
    format.fields.filter((field) => field.t === "cumple" && field.includeTime).map((field) => field.n),
  );
  for (const field of format.fields) {
    if (field.t === "cumple" && field.includeTime && field.timeRequired && !times[field.n]) {
      return `La hora de "${field.n}" es obligatoria.`;
    }
  }
  for (const [fieldName, value] of Object.entries(times)) {
    if (!configuredFields.has(fieldName)) {
      return `El campo "${fieldName}" no tiene una hora configurada.`;
    }
    if (value === "") continue;
    if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return `La hora de "${fieldName}" debe tener el formato HH:mm.`;
    }
  }
  return "";
}

export function parsePagination(query) {
  const hasPagination = query.page != null || query.limit != null;
  if (!hasPagination) return { error: "", pagination: null };
  const page = query.page == null ? 1 : Number(query.page);
  const pageSize = query.limit == null ? 25 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1) {
    return { error: "La página debe ser un entero mayor que cero.", pagination: null };
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return { error: "El límite por página debe estar entre 1 y 100.", pagination: null };
  }
  return { error: "", pagination: { page, pageSize, offset: (page - 1) * pageSize } };
}

export function traceRecordsSql() {
  return `SELECT r.*
    FROM "records" AS r
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_each_text(r."vals") AS field(key, value)
      WHERE lower(field.value) = lower($lot)
    )
    ORDER BY r."date" ASC, r."createdAt" ASC`;
}
