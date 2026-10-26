import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { Op } from "sequelize";
import { sequelize, Document, Format, Record, Schedule, CorrectiveAction, MasterItem, AppSetting, User } from "./database.js";
import { authenticate, publicUser, requireRoles, signAccessToken } from "./auth.js";
import { DEFAULT_FORMATS, MASTER_CATEGORIES, MODULES } from "./modules.js";
import { evaluateRecord, parsePagination, recordDateMatchesMonth, traceRecordsSql, validMonth, validateFormat } from "./domain.js";
import dispatchRoutes from "./dispatch-routes.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const moduleIds = new Set(MODULES.map(([id]) => id));
const scheduleIntervals = new Set(["Única", "1", "7", "15", "30", "90", "180", "365"]);
const userRoles = new Set(["super", "user_admin", "user"]);
const actionStates = new Set(["Abierta", "En proceso", "Pendiente de verificación", "Cerrada"]);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesión. Espera 15 minutos e inténtalo de nuevo." },
});
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const allowedOrigins = (process.env.CORS_ORIGIN || "https://prueba-d-lechonaxdxd.vercel.app,http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("El origen no está autorizado para acceder a esta API."));
  },
}));
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const originalEnd = res.end;
  res.end = function (...args) {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (!this.headersSent) this.setHeader("Server-Timing", `app;dur=${elapsedMs.toFixed(1)}`);
    if (process.env.LOG_HTTP_TIMING === "true") {
      console.info(`[http] ${req.method} ${req.path} ${this.statusCode} ${elapsedMs.toFixed(1)}ms`);
    }
    return originalEnd.apply(this, args);
  };
  next();
});
app.use(express.json({ limit: "20mb" }));

function requireModule(req, res, next) {
  if (!moduleIds.has(req.params.moduleId)) return res.status(404).json({ error: "Programa no encontrado." });
  next();
}

function requireBodyObject(req, res, next) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON." });
  }
  next();
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function getProgram(moduleId, includeDocumentData = false, recordMonth = "", includeRecords = true) {
  const documentQuery = {
    where: { moduleId },
    order: [["createdAt", "DESC"]],
  };
  if (!includeDocumentData) documentQuery.attributes = { exclude: ["data"] };
  const recordWhere = { moduleId };
  if (recordMonth) {
    const [year, monthNumber] = recordMonth.split("-").map(Number);
    recordWhere.date = {
      [Op.gte]: `${recordMonth}-01`,
      [Op.lt]: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10),
    };
  }
  const [documents, formats, records, schedules, actions] = await Promise.all([
    Document.findAll(documentQuery),
    Format.findAll({ where: { moduleId }, order: [["createdAt", "ASC"]] }),
    includeRecords
      ? Record.findAll({ where: recordWhere, order: [["date", "DESC"], ["createdAt", "DESC"]] })
      : Promise.resolve([]),
    Schedule.findAll({ where: { moduleId }, order: [["date", "ASC"]] }),
    CorrectiveAction.findAll({ where: { moduleId }, order: [["createdAt", "DESC"]] }),
  ]);
  return { documents, formats, records, schedules, actions };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthOf(date) {
  return String(date || "").slice(0, 7);
}

function validateEquipmentConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? rawConfig : {};
  const type = String(config.type || "").trim();
  const min = config.min === "" || config.min == null ? null : Number(config.min);
  const max = config.max === "" || config.max == null ? null : Number(config.max);
  if (!new Set(["Refrigeración", "Congelación"]).has(type)) {
    return { error: "Selecciona si el equipo es de refrigeración o congelación." };
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { error: "El rango del equipo debe tener un mínimo y máximo válidos." };
  }
  return { error: "", value: { type, min, max } };
}

async function makeReport(ids, month) {
  const now = today();
  const alerts = [];
  const rows = [];
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const moduleNames = new Map(MODULES.map(([id, name]) => [id, name]));
  const [records, formats, actions, schedules, documents] = await Promise.all([
    Record.findAll({
      where: { moduleId: { [Op.in]: ids }, date: { [Op.gte]: `${month}-01`, [Op.lt]: nextMonth } },
      attributes: ["id", "moduleId", "fmt", "date", "resp", "vals", "devs", "obs"],
    }),
    Format.findAll({ where: { moduleId: { [Op.in]: ids } }, attributes: ["id", "moduleId", "name"] }),
    CorrectiveAction.findAll({
      where: { moduleId: { [Op.in]: ids }, e: { [Op.ne]: "Cerrada" } },
      attributes: ["moduleId", "desc", "due"],
    }),
    Schedule.findAll({
      where: { moduleId: { [Op.in]: ids }, ok: false, date: { [Op.lt]: now } },
      attributes: ["moduleId", "name", "date"],
    }),
    Document.findAll({
      where: { moduleId: { [Op.in]: ids }, rev: { [Op.not]: null, [Op.lt]: now } },
      attributes: ["moduleId", "name", "ver", "rev"],
    }),
  ]);
  const formatNames = new Map(formats.map((format) => [format.id, format.name]));
  const totals = {
    records: records.length,
    deviations: records.filter((record) => record.devs.length).length,
    openActions: actions.length,
    overdueSchedules: schedules.length,
  };
  records.forEach((record) => {
    const moduleName = moduleNames.get(record.moduleId);
    rows.push({
      moduleId: record.moduleId,
      moduleName,
      formatId: record.fmt,
      format: formatNames.get(record.fmt) || "(formato eliminado)",
      date: record.date,
      responsible: record.resp,
      values: record.vals,
      deviations: record.devs,
      observations: record.obs,
    });
  });
  actions.forEach((action) => {
    const overdue = action.due < now;
    alerts.push({
      moduleId: action.moduleId,
      moduleName: moduleNames.get(action.moduleId),
      kind: overdue ? "Acción vencida" : "Acción correctiva pendiente",
      description: `${action.desc} (límite ${action.due})`,
    });
  });
  schedules.forEach((schedule) => {
    alerts.push({ moduleId: schedule.moduleId, moduleName: moduleNames.get(schedule.moduleId), kind: "Actividad vencida", description: `${schedule.name} (${schedule.date})` });
  });
  documents.forEach((document) => {
    alerts.push({ moduleId: document.moduleId, moduleName: moduleNames.get(document.moduleId), kind: "Documento por revisar", description: `${document.name} v${document.ver} (${document.rev})` });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    month,
    totals: {
      ...totals,
      conformity: totals.records ? Math.round((100 * (totals.records - totals.deviations)) / totals.records) : 100,
    },
    records: rows,
    alerts,
  };
}

async function getLastBackup() {
  const setting = await AppSetting.findByPk("lastBackup");
  return setting?.value || "";
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await sequelize.authenticate();
  res.json({ status: "ok" });
}));

app.post("/api/auth/login", loginLimiter, requireBodyObject, asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim().toLocaleLowerCase("en-US");
  const password = String(req.body.password || "");
  if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios." });

  const user = await User.findOne({ where: { username } });
  const passwordMatches = user && await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches || !user.active) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }

  await user.update({ lastLoginAt: new Date() });
  res.json({ token: signAccessToken(user), user: publicUser(user) });
}));

app.use("/api", authenticate);
app.use("/api", dispatchRoutes);

app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));

app.get("/api/auth/users", requireRoles("super", "user_admin"), asyncRoute(async (_req, res) => {
  const users = await User.findAll({
    attributes: ["id", "username", "name", "role", "active", "createdAt", "lastLoginAt"],
    order: [["createdAt", "ASC"]],
  });
  res.json(users);
}));

app.post("/api/auth/users", requireRoles("super", "user_admin"), requireBodyObject, asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim().toLocaleLowerCase("en-US");
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "user");

  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    return res.status(400).json({ error: "El usuario debe tener 3–50 caracteres: letras sin tilde, números, punto, guion o guion bajo." });
  }
  if (!name || name.length > 120) return res.status(400).json({ error: "El nombre es obligatorio y no puede superar 120 caracteres." });
  if (password.length < 12) return res.status(400).json({ error: "La contraseña debe tener al menos 12 caracteres." });
  if (!userRoles.has(role)) return res.status(400).json({ error: "El rol indicado no es válido." });
  if (req.user.role !== "super" && role !== "user") {
    return res.status(403).json({ error: "Solo el super administrador puede crear administradores." });
  }

  const existing = await User.findOne({ where: { username } });
  if (existing) return res.status(409).json({ error: "Ya existe una cuenta con ese nombre de usuario." });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, name, passwordHash, role });
  res.status(201).json(publicUser(user));
}));

app.patch("/api/auth/users/:id/status", requireRoles("super", "user_admin"), requireBodyObject, asyncRoute(async (req, res) => {
  if (typeof req.body.active !== "boolean") {
    return res.status(400).json({ error: "El estado active debe ser verdadero o falso." });
  }
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  if (user.id === req.user.id && !req.body.active) {
    return res.status(400).json({ error: "No puedes desactivar tu propia cuenta." });
  }
  if (req.user.role !== "super" && user.role !== "user") {
    return res.status(403).json({ error: "Solo el super administrador puede modificar cuentas administrativas." });
  }
  if (!req.body.active && user.role === "super") {
    const activeSuperCount = await User.count({ where: { role: "super", active: true } });
    if (activeSuperCount <= 1) return res.status(409).json({ error: "No se puede desactivar el último super administrador activo." });
  }
  await user.update({ active: req.body.active });
  res.json(publicUser(user));
}));

app.get("/api/bootstrap", asyncRoute(async (_req, res) => {
  const [masterRows, formats, lastBackup] = await Promise.all([
    MasterItem.findAll({ order: [["category", "ASC"], ["value", "ASC"]] }),
    Format.findAll({ attributes: ["id", "moduleId", "name", "fields"], order: [["createdAt", "ASC"]] }),
    getLastBackup(),
  ]);
  const masters = Object.fromEntries(Object.keys(MASTER_CATEGORIES).map((category) => [category, []]));
  masterRows.forEach((item) => {
    if (Object.hasOwn(masters, item.category)) masters[item.category].push(item);
  });
  res.json({
    modules: MODULES.map(([id, name]) => ({ id, name })),
    masters,
    formats,
    lastBackup,
  });
}));

app.get("/api/modules", (_req, res) => res.json(MODULES.map(([id, name]) => ({ id, name }))));

app.get("/api/modules/:moduleId", requireModule, asyncRoute(async (req, res) => {
  const month = String(req.query.month || "");
  if (month && !validMonth(month)) return res.status(400).json({ error: "El mes debe tener el formato AAAA-MM." });
  res.json(await getProgram(req.params.moduleId, false, month, req.query.records !== "0"));
}));

app.get("/api/modules/:moduleId/:resource", requireModule, asyncRoute(async (req, res) => {
  const resources = {
    documents: [Document, "createdAt"],
    formats: [Format, "createdAt"],
    records: [Record, "date"],
    schedules: [Schedule, "date"],
    actions: [CorrectiveAction, "createdAt"],
  };
  const resource = resources[req.params.resource];
  if (!resource) return res.status(404).json({ error: "Recurso no encontrado." });
  const { error, pagination } = parsePagination(req.query);
  if (error) return res.status(400).json({ error });
  const query = {
    where: { moduleId: req.params.moduleId },
    order: req.params.resource === "records"
      ? [["date", "DESC"], ["createdAt", "DESC"], ["id", "DESC"]]
      : [[resource[1], "ASC"], ["id", "ASC"]],
  };
  if (req.params.resource === "documents") query.attributes = { exclude: ["data"] };
  if (req.params.resource === "records") {
    const month = String(req.query.month || "");
    if (month && !validMonth(month)) return res.status(400).json({ error: "El mes debe tener el formato AAAA-MM." });
    if (month) {
      const [year, monthNumber] = month.split("-").map(Number);
      query.where.date = {
        [Op.gte]: `${month}-01`,
        [Op.lt]: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10),
      };
    }
    const formatId = String(req.query.format || "");
    if (formatId) query.where.fmt = formatId;
  }
  if (pagination) {
    const result = await resource[0].findAndCountAll({
      ...query,
      limit: pagination.pageSize,
      offset: pagination.offset,
    });
    return res.json({
      items: result.rows,
      total: result.count,
      page: pagination.page,
      pageSize: pagination.pageSize,
      pages: Math.ceil(result.count / pagination.pageSize),
    });
  }
  res.json(await resource[0].findAll(query));
}));

app.get("/api/modules/:moduleId/documents/:id", requireModule, asyncRoute(async (req, res) => {
  const document = await Document.findOne({
    where: { id: req.params.id, moduleId: req.params.moduleId },
    attributes: ["id", "file", "data"],
  });
  if (!document) return res.status(404).json({ error: "Documento no encontrado." });
  res.json(document);
}));

app.post("/api/modules/:moduleId/documents", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { name, tipo, ver, rev, file, data } = req.body;
  if (!String(name || "").trim()) return res.status(400).json({ error: "El nombre del documento es obligatorio." });
  if (data && (!String(data).startsWith("data:") || String(data).length > 2_100_000)) {
    return res.status(413).json({ error: "El archivo debe ser válido y pesar máximo 1,5 MB." });
  }
  const document = await Document.create({ moduleId: req.params.moduleId, name: String(name).trim(), tipo, ver, rev: rev || null, file, data });
  const savedDocument = document.toJSON();
  delete savedDocument.data;
  res.status(201).json(savedDocument);
}));

app.delete("/api/modules/:moduleId/documents/:id", requireModule, asyncRoute(async (req, res) => {
  const count = await Document.destroy({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!count) return res.status(404).json({ error: "Documento no encontrado." });
  res.status(204).end();
}));

app.post("/api/modules/:moduleId/formats", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { name, freq, fields } = req.body;
  const validationError = validateFormat(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const format = await Format.create({ moduleId: req.params.moduleId, name: String(name).trim(), freq, fields });
  res.status(201).json(format);
}));

app.put("/api/modules/:moduleId/formats/:id", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const format = await Format.findOne({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!format) return res.status(404).json({ error: "Formato no encontrado." });
  const { name, freq, fields } = req.body;
  const validationError = validateFormat(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  await format.update({ name: String(name).trim(), freq, fields });
  res.json(format);
}));

app.delete("/api/modules/:moduleId/formats/:id", requireModule, asyncRoute(async (req, res) => {
  const count = await Format.destroy({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!count) return res.status(404).json({ error: "Formato no encontrado." });
  res.status(204).end();
}));

app.post("/api/modules/:moduleId/records", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { fmt, date, resp = "", obs = "", vals = {} } = req.body;
  if (!fmt || !date || !vals || typeof vals !== "object" || Array.isArray(vals)) {
    return res.status(400).json({ error: "Formato, fecha y valores del registro son obligatorios." });
  }
  const recordDate = String(date);
  const month = String(req.body.month || recordDate.slice(0, 7));
  if (!recordDateMatchesMonth(recordDate, month)) {
    return res.status(400).json({ error: "La fecha del registro debe pertenecer al mes seleccionado." });
  }
  const format = await Format.findOne({ where: { id: fmt, moduleId: req.params.moduleId } });
  if (!format) return res.status(400).json({ error: "El formato indicado no existe en este programa." });
  const hasInvalidNumber = format.fields.some((field) => {
    const value = vals[field.n];
    return field.t === "num" && value !== "" && value != null && !Number.isFinite(Number(value));
  });
  if (hasInvalidNumber) return res.status(400).json({ error: "Cada campo numérico debe contener un número válido." });
  let dynamicRanges = {};
  const equipmentField = format.fields.find((field) => field.t === "equipo");
  const equipmentValue = equipmentField ? vals[equipmentField.n] : "";
  if (req.params.moduleId === "temp" && equipmentValue) {
    const equipment = await MasterItem.findOne({ where: { category: "equipos", value: String(equipmentValue) } });
    const min = equipment?.config?.min;
    const max = equipment?.config?.max;
    if (min !== "" && min != null && max !== "" && max != null) {
      const temperatureField = format.fields.find((field) => field.t === "num" && field.n.toLocaleLowerCase("es").includes("temperatura"));
      if (temperatureField) dynamicRanges[temperatureField.n] = {
        min,
        max,
        label: `${equipment.value} (${equipment.config.type || "equipo"})`,
      };
    }
  }
  const devs = evaluateRecord(format, vals, dynamicRanges);
  const result = await sequelize.transaction(async (transaction) => {
    const record = await Record.create({ moduleId: req.params.moduleId, fmt, date, resp, obs, vals, devs }, { transaction });
    let action = null;
    if (devs.length) {
      action = await CorrectiveAction.create({
        moduleId: req.params.moduleId,
        desc: `${format.name} (${date}): ${devs.join("; ")}`,
        resp,
        due: addDays(date, 3),
        e: "Abierta",
        cierre: "",
        rec: record.id,
      }, { transaction });
    }
    return { record, action };
  });
  res.status(201).json(result);
}));

app.delete("/api/modules/:moduleId/records/:id", requireModule, asyncRoute(async (req, res) => {
  const count = await Record.destroy({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!count) return res.status(404).json({ error: "Registro no encontrado." });
  res.status(204).end();
}));

app.post("/api/modules/:moduleId/schedules", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { name, date, rep = "Única", resp = "" } = req.body;
  if (!String(name || "").trim() || !date) return res.status(400).json({ error: "Actividad y fecha son obligatorias." });
  if (!scheduleIntervals.has(String(rep))) return res.status(400).json({ error: "La repetición indicada no es válida." });
  res.status(201).json(await Schedule.create({ moduleId: req.params.moduleId, name: String(name).trim(), date, rep, resp }));
}));

app.post("/api/modules/:moduleId/schedules/:id/complete", requireModule, asyncRoute(async (req, res) => {
  const result = await sequelize.transaction(async (transaction) => {
    const schedule = await Schedule.findOne({ where: { id: req.params.id, moduleId: req.params.moduleId }, transaction });
    if (!schedule) return null;
    await schedule.update({ ok: true, doneOn: today() }, { transaction });
    let next = null;
    const interval = Number(schedule.rep);
    if (schedule.rep !== "Única" && Number.isInteger(interval) && interval > 0) {
      next = await Schedule.create({
        moduleId: schedule.moduleId,
        name: schedule.name,
        date: addDays(schedule.date, interval),
        rep: schedule.rep,
        resp: schedule.resp,
        ok: false,
      }, { transaction });
    }
    return { schedule, next };
  });
  if (!result) return res.status(404).json({ error: "Actividad no encontrada." });
  res.json(result);
}));

app.delete("/api/modules/:moduleId/schedules/:id", requireModule, asyncRoute(async (req, res) => {
  const count = await Schedule.destroy({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!count) return res.status(404).json({ error: "Actividad no encontrada." });
  res.status(204).end();
}));

app.post("/api/modules/:moduleId/actions", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { desc, resp = "", due } = req.body;
  if (!String(desc || "").trim() || !due) return res.status(400).json({ error: "Descripción y fecha límite son obligatorias." });
  res.status(201).json(await CorrectiveAction.create({
    moduleId: req.params.moduleId, desc: String(desc).trim(), resp, due, e: "Abierta", cierre: "",
  }));
}));

app.post("/api/modules/:moduleId/actions/:id/close", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const action = await CorrectiveAction.findOne({ where: { id: req.params.id, moduleId: req.params.moduleId, e: "Abierta" } });
  if (!action) return res.status(404).json({ error: "Acción abierta no encontrada." });
  const detail = String(req.body.cierre || "").trim();
  const closedBy = String(req.body.closedBy || "").trim();
  if (![action.correction, action.cause, action.actionPlan, action.evidence, detail, closedBy].every(Boolean)) {
    return res.status(400).json({ error: "Completa la gestión y la verificación antes de cerrar la acción." });
  }
  await action.update({ e: "Cerrada", verification: detail, closedBy, closedOn: today(), cierre: `${detail} (${today()})` });
  res.json(action);
}));

app.put("/api/modules/:moduleId/actions/:id", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const action = await CorrectiveAction.findOne({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!action) return res.status(404).json({ error: "Acción correctiva no encontrada." });
  const next = {
    correction: String(req.body.correction ?? action.correction ?? "").trim(),
    cause: String(req.body.cause ?? action.cause ?? "").trim(),
    actionPlan: String(req.body.actionPlan ?? action.actionPlan ?? "").trim(),
    evidence: String(req.body.evidence ?? action.evidence ?? "").trim(),
    verification: String(req.body.verification ?? action.verification ?? "").trim(),
    closedBy: String(req.body.closedBy ?? action.closedBy ?? "").trim(),
    resp: String(req.body.resp ?? action.resp ?? "").trim(),
    due: String(req.body.due ?? action.due),
    e: String(req.body.e ?? action.e),
  };
  if (!actionStates.has(next.e)) return res.status(400).json({ error: "El estado de la acción no es válido." });
  if (!recordDateMatchesMonth(next.due, next.due.slice(0, 7))) {
    return res.status(400).json({ error: "La fecha límite no es válida." });
  }
  if (next.e === "Cerrada") {
    const required = [next.correction, next.cause, next.actionPlan, next.evidence, next.verification, next.closedBy];
    if (required.some((value) => !value)) {
      return res.status(400).json({ error: "Para cerrar debes completar corrección, causa, plan, evidencia, verificación y responsable del cierre." });
    }
    next.closedOn = today();
    next.cierre = `${next.verification} (${next.closedOn})`;
  } else {
    next.closedOn = null;
    next.cierre = "";
  }
  await action.update(next);
  res.json(action);
}));

app.delete("/api/modules/:moduleId/actions/:id", requireModule, asyncRoute(async (req, res) => {
  const count = await CorrectiveAction.destroy({ where: { id: req.params.id, moduleId: req.params.moduleId } });
  if (!count) return res.status(404).json({ error: "Acción no encontrada." });
  res.status(204).end();
}));

app.get("/api/masters", asyncRoute(async (_req, res) => {
  const entries = await Promise.all(Object.keys(MASTER_CATEGORIES).map(async (category) => [
    category,
    await MasterItem.findAll({ where: { category }, order: [["value", "ASC"]] }),
  ]));
  res.json(Object.fromEntries(entries));
}));

app.post("/api/masters/:category", requireBodyObject, asyncRoute(async (req, res) => {
  const { category } = req.params;
  const value = String(req.body.value || "").trim();
  if (!Object.hasOwn(MASTER_CATEGORIES, category)) return res.status(404).json({ error: "Tipo de maestro no encontrado." });
  if (!value) return res.status(400).json({ error: "El valor es obligatorio." });
  const config = category === "equipos" ? validateEquipmentConfig(req.body.config) : { error: "", value: {} };
  if (config.error) return res.status(400).json({ error: config.error });
  const [item, created] = await MasterItem.findOrCreate({ where: { category, value }, defaults: { category, value, config: config.value } });
  res.status(created ? 201 : 200).json(item);
}));

app.put("/api/masters/:category/:id", requireBodyObject, asyncRoute(async (req, res) => {
  if (req.params.category !== "equipos") return res.status(400).json({ error: "Este maestro no admite configuración." });
  const item = await MasterItem.findOne({ where: { id: req.params.id, category: "equipos" } });
  if (!item) return res.status(404).json({ error: "Equipo no encontrado." });
  const config = validateEquipmentConfig(req.body.config);
  if (config.error) return res.status(400).json({ error: config.error });
  await item.update({ config: config.value });
  res.json(item);
}));

app.delete("/api/masters/:category/:id", asyncRoute(async (req, res) => {
  if (!Object.hasOwn(MASTER_CATEGORIES, req.params.category)) return res.status(404).json({ error: "Tipo de maestro no encontrado." });
  const count = await MasterItem.destroy({ where: { id: req.params.id, category: req.params.category } });
  if (!count) return res.status(404).json({ error: "Elemento maestro no encontrado." });
  res.status(204).end();
}));

app.get("/api/reports", asyncRoute(async (req, res) => {
  const month = String(req.query.month || today().slice(0, 7));
  if (!validMonth(month)) return res.status(400).json({ error: "El mes debe tener el formato AAAA-MM." });
  const ids = req.query.module ? [String(req.query.module)] : MODULES.map(([id]) => id);
  if (ids.some((id) => !moduleIds.has(id))) return res.status(400).json({ error: "Programa no encontrado." });
  res.json(await makeReport(ids, month));
}));

app.get("/api/trace", asyncRoute(async (req, res) => {
  const lot = String(req.query.lot || "").trim().toLocaleLowerCase();
  if (!lot) return res.json({ lot: "", results: [] });
  const [records, formats] = await Promise.all([
    sequelize.query(traceRecordsSql(), { bind: { lot }, model: Record, mapToModel: true }),
    Format.findAll({ attributes: ["id", "moduleId", "name"] }),
  ]);
  const formatNames = new Map(formats.map((format) => [`${format.moduleId}:${format.id}`, format.name]));
  res.json({
    lot,
    results: results.map((record) => ({
      ...record.toJSON(),
      formatName: formatNames.get(`${record.moduleId}:${record.fmt}`) || "(formato eliminado)",
      moduleName: MODULES.find(([id]) => id === record.moduleId)?.[1],
    })),
  });
}));

async function exportBackup(month) {
  const programs = {};
  for (const [moduleId] of MODULES) {
    const data = await getProgram(moduleId, true);
    programs[moduleId] = {
      docs: data.documents.map((item) => item.toJSON()),
      formats: data.formats.map((item) => item.toJSON()),
      records: data.records
        .filter((item) => !month || monthOf(item.date) === month)
        .map((item) => item.toJSON()),
      sched: data.schedules.map((item) => item.toJSON()),
      acts: data.actions.map((item) => item.toJSON()),
    };
  }
  const masterRows = await MasterItem.findAll();
  const mae = Object.fromEntries(Object.keys(MASTER_CATEGORIES).map((category) => [
    category, masterRows.filter((item) => item.category === category).map((item) => item.value),
  ]));
  return { mods: programs, mae, lastBackup: await getLastBackup() };
}

app.get("/api/backup", asyncRoute(async (req, res) => {
  const month = req.query.month ? String(req.query.month) : "";
  if (month && !validMonth(month)) return res.status(400).json({ error: "El mes debe tener el formato AAAA-MM." });
  await AppSetting.upsert({ key: "lastBackup", value: today() });
  const backup = await exportBackup(month);
  backup.lastBackup = today();
  res.json(backup);
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ error: "Ya existe un elemento con esos datos." });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ error: "Los datos enviados no son válidos." });
  }
  res.status(500).json({ error: "Error interno del servidor." });
});

async function start() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET es obligatorio y debe tener al menos 32 bytes. Ejecuta npm run create-users para generar uno localmente.");
  }
  await sequelize.authenticate();
  await sequelize.sync();
  await sequelize.query('ALTER TABLE "master_items" ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT \'{}\'::jsonb');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "correction" TEXT NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "cause" TEXT NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "actionPlan" TEXT NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "evidence" TEXT NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "verification" TEXT NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "closedBy" VARCHAR(160) NOT NULL DEFAULT \'\'');
  await sequelize.query('ALTER TABLE "corrective_actions" ADD COLUMN IF NOT EXISTS "closedOn" DATE');
  await sequelize.query('ALTER TABLE "corrective_actions" ALTER COLUMN "e" TYPE VARCHAR(40)');
  for (const [moduleId, formats] of Object.entries(DEFAULT_FORMATS)) {
    for (const format of formats) {
      await Format.findOrCreate({
        where: { moduleId, id: format.id },
        defaults: { moduleId, ...format },
      });
    }
  }
  app.listen(port, () => console.log(`API lista en http://localhost:${port}`));
}

start().catch((error) => {
  console.error("No fue posible iniciar la API. Verifica DATABASE_URL y el acceso a Neon.", error);
  process.exitCode = 1;
});
