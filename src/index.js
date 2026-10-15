import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { Op } from "sequelize";
import { sequelize, Document, Format, Record, Schedule, CorrectiveAction, MasterItem, AppSetting, User } from "./database.js";
import { authenticate, publicUser, requireRoles, signAccessToken } from "./auth.js";
import { DEFAULT_FORMATS, MASTER_CATEGORIES, MODULES } from "./modules.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const moduleIds = new Set(MODULES.map(([id]) => id));
const frequencies = new Set(["Diario", "Semanal", "Quincenal", "Mensual", "Por evento"]);
const scheduleIntervals = new Set(["Única", "1", "7", "15", "30", "90", "180", "365"]);
const fieldTypes = new Set(["num", "txt", "date", "sel", "chk", "producto", "area", "punto", "proveedor", "cliente", "equipo", "lote"]);
const userRoles = new Set(["super", "user_admin", "user"]);
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

function evaluateRecord(format, values) {
  const deviations = [];
  for (const field of format.fields) {
    const value = values[field.n];
    if (field.t === "num" && value !== "" && value != null && Number.isFinite(Number(value))) {
      const number = Number(value);
      if ((field.min !== "" && field.min != null && number < Number(field.min)) ||
          (field.max !== "" && field.max != null && number > Number(field.max))) {
        deviations.push(`${field.n}: ${value}${field.u ? ` ${field.u}` : ""} fuera de rango [${field.min ?? "–"} a ${field.max ?? "–"}]`);
      }
    }
    if (field.t === "chk" && value === "No") deviations.push(`${field.n}: No conforme`);
  }
  return deviations;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function getProgram(moduleId) {
  const [documents, formats, records, schedules, actions] = await Promise.all([
    Document.findAll({ where: { moduleId }, order: [["createdAt", "DESC"]] }),
    Format.findAll({ where: { moduleId }, order: [["createdAt", "ASC"]] }),
    Record.findAll({ where: { moduleId }, order: [["date", "DESC"], ["createdAt", "DESC"]] }),
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

function validMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  return true;
}

function validateFormat({ name, freq, fields }) {
  if (!String(name || "").trim() || !Array.isArray(fields) || fields.length === 0) {
    return "El formato requiere nombre y al menos un campo.";
  }
  if (!frequencies.has(freq)) return "La frecuencia indicada no es válida.";
  for (const field of fields) {
    if (!field || !String(field.n || "").trim() || !fieldTypes.has(field.t)) {
      return "Todos los campos deben tener un nombre y un tipo válido.";
    }
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

async function collectAlerts(ids, month) {
  const now = today();
  const alerts = [];
  for (const moduleId of ids) {
    const [records, formats, actions, schedules, documents] = await Promise.all([
      Record.findAll({ where: { moduleId } }),
      Format.findAll({ where: { moduleId }, attributes: ["id", "name"] }),
      CorrectiveAction.findAll({ where: { moduleId, e: "Abierta", due: { [Op.lt]: now } } }),
      Schedule.findAll({ where: { moduleId, ok: false, date: { [Op.lt]: now } } }),
      Document.findAll({ where: { moduleId, rev: { [Op.not]: null, [Op.lt]: now } } }),
    ]);
    const formatNames = new Map(formats.map((format) => [format.id, format.name]));
    records.filter((record) => record.devs.length && monthOf(record.date) === month).forEach((record) => {
      alerts.push({ moduleId, moduleName: MODULES.find(([id]) => id === moduleId)?.[1], kind: "Desviación", description: `${formatNames.get(record.fmt) || "(formato eliminado)"} · ${record.date} · ${record.devs.join("; ")}` });
    });
    const moduleName = MODULES.find(([id]) => id === moduleId)?.[1];
    actions.forEach((action) => alerts.push({ moduleId, moduleName, kind: "Acción vencida", description: `${action.desc} (límite ${action.due})` }));
    schedules.forEach((schedule) => alerts.push({ moduleId, moduleName, kind: "Actividad vencida", description: `${schedule.name} (${schedule.date})` }));
    documents.forEach((document) => alerts.push({ moduleId, moduleName, kind: "Documento por revisar", description: `${document.name} v${document.ver} (${document.rev})` }));
  }
  return alerts;
}

async function makeReport(ids, month) {
  const rows = [];
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  let totals = { records: 0, deviations: 0, openActions: 0, overdueSchedules: 0 };
  for (const moduleId of ids) {
    const [records, formats, actions, schedules] = await Promise.all([
      Record.findAll({ where: { moduleId, date: { [Op.gte]: `${month}-01`, [Op.lt]: nextMonth } } }),
      Format.findAll({ where: { moduleId }, attributes: ["id", "name"] }),
      CorrectiveAction.findAll({ where: { moduleId, e: "Abierta" } }),
      Schedule.findAll({ where: { moduleId, ok: false, date: { [Op.lt]: today() } } }),
    ]);
    const names = new Map(formats.map((format) => [format.id, format.name]));
    totals.records += records.length;
    totals.deviations += records.filter((record) => record.devs.length).length;
    totals.openActions += actions.length;
    totals.overdueSchedules += schedules.length;
    records.forEach((record) => rows.push({
      moduleId,
      moduleName: MODULES.find(([id]) => id === moduleId)?.[1],
      format: names.get(record.fmt) || "(formato eliminado)",
      date: record.date,
      responsible: record.resp,
      values: record.vals,
      deviations: record.devs,
      observations: record.obs,
    }));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    month,
    totals: {
      ...totals,
      conformity: totals.records ? Math.round((100 * (totals.records - totals.deviations)) / totals.records) : 100,
    },
    records: rows,
    alerts: await collectAlerts(ids, month),
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
  const programEntries = await Promise.all(MODULES.map(async ([id]) => [id, await getProgram(id)]));
  const masterEntries = await Promise.all(Object.keys(MASTER_CATEGORIES).map(async (category) => {
    const items = await MasterItem.findAll({ where: { category }, order: [["value", "ASC"]] });
    return [category, items];
  }));
  res.json({
    modules: MODULES.map(([id, name]) => ({ id, name })),
    masters: Object.fromEntries(masterEntries),
    programs: Object.fromEntries(programEntries),
    lastBackup: await getLastBackup(),
  });
}));

app.get("/api/modules", (_req, res) => res.json(MODULES.map(([id, name]) => ({ id, name }))));

app.get("/api/modules/:moduleId", requireModule, asyncRoute(async (req, res) => {
  res.json(await getProgram(req.params.moduleId));
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
  res.json(await resource[0].findAll({
    where: { moduleId: req.params.moduleId },
    order: [[resource[1], req.params.resource === "records" ? "DESC" : "ASC"]],
  }));
}));

app.post("/api/modules/:moduleId/documents", requireModule, requireBodyObject, asyncRoute(async (req, res) => {
  const { name, tipo, ver, rev, file, data } = req.body;
  if (!String(name || "").trim()) return res.status(400).json({ error: "El nombre del documento es obligatorio." });
  if (data && (!String(data).startsWith("data:") || String(data).length > 2_100_000)) {
    return res.status(413).json({ error: "El archivo debe ser válido y pesar máximo 1,5 MB." });
  }
  const document = await Document.create({ moduleId: req.params.moduleId, name: String(name).trim(), tipo, ver, rev: rev || null, file, data });
  res.status(201).json(document);
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
  const format = await Format.findOne({ where: { id: fmt, moduleId: req.params.moduleId } });
  if (!format) return res.status(400).json({ error: "El formato indicado no existe en este programa." });
  const hasInvalidNumber = format.fields.some((field) => {
    const value = vals[field.n];
    return field.t === "num" && value !== "" && value != null && !Number.isFinite(Number(value));
  });
  if (hasInvalidNumber) return res.status(400).json({ error: "Cada campo numérico debe contener un número válido." });
  const devs = evaluateRecord(format, vals);
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
  await action.update({ e: "Cerrada", cierre: `${detail} (${today()})` });
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
  if (!masterCategories.has(category)) return res.status(404).json({ error: "Tipo de maestro no encontrado." });
  if (!value) return res.status(400).json({ error: "El valor es obligatorio." });
  const [item, created] = await MasterItem.findOrCreate({ where: { category, value }, defaults: { category, value } });
  res.status(created ? 201 : 200).json(item);
}));

app.delete("/api/masters/:category/:id", asyncRoute(async (req, res) => {
  if (!masterCategories.has(req.params.category)) return res.status(404).json({ error: "Tipo de maestro no encontrado." });
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
  const records = await Record.findAll({ order: [["date", "ASC"]] });
  const results = records.filter((record) => Object.values(record.vals).some((value) => String(value).toLocaleLowerCase() === lot));
  const formats = await Format.findAll({ attributes: ["id", "moduleId", "name"] });
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
    const data = await getProgram(moduleId);
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
    return res.status(409).json({ error: "Ya existe un usuario con ese nombre de usuario." });
  }
  if (error.name === "SequelizeValidationError" || error.name === "SequelizeDatabaseError") {
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: "Error interno del servidor." });
});

async function start() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET es obligatorio y debe tener al menos 32 bytes. Ejecuta npm run create-users para generar uno localmente.");
  }
  await sequelize.authenticate();
  await sequelize.sync();
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
