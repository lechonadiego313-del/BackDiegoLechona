import "dotenv/config";
import { Sequelize, DataTypes } from "sequelize";

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL. Configúrala con la cadena de conexión de Neon.");
}

function poolSetting(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}

const poolMax = poolSetting("DB_POOL_MAX", 5, 1, 20);
const poolMin = poolSetting("DB_POOL_MIN", 0, 0, poolMax);
const poolAcquire = poolSetting("DB_POOL_ACQUIRE_MS", 30000, 1000, 120000);
const poolIdle = poolSetting("DB_POOL_IDLE_MS", 10000, 1000, 120000);

export const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  benchmark: true,
  logging: process.env.LOG_DB_TIMING === "true"
    ? (_sql, elapsedMs) => console.info(`[db] ${Number(elapsedMs).toFixed(1)}ms`)
    : false,
  pool: { max: poolMax, min: poolMin, acquire: poolAcquire, idle: poolIdle },
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false },
  },
});

const commonFields = () => ({
  id: { type: DataTypes.STRING(80), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  moduleId: { type: DataTypes.STRING(20), allowNull: false },
});

export const Document = sequelize.define(
  "Document",
  {
    ...commonFields(),
    name: { type: DataTypes.STRING(200), allowNull: false },
    tipo: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Otro" },
    ver: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "1" },
    rev: { type: DataTypes.DATEONLY, allowNull: true },
    file: { type: DataTypes.STRING(255), allowNull: true },
    data: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: "documents", timestamps: true },
);

export const Format = sequelize.define(
  "Format",
  {
    ...commonFields(),
    name: { type: DataTypes.STRING(200), allowNull: false },
    freq: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Diario" },
    fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  { tableName: "formats", timestamps: true },
);

export const Record = sequelize.define(
  "Record",
  {
    ...commonFields(),
    fmt: { type: DataTypes.STRING(100), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    resp: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
    obs: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    vals: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    devs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  { tableName: "records", timestamps: true },
);

export const Schedule = sequelize.define(
  "Schedule",
  {
    ...commonFields(),
    name: { type: DataTypes.STRING(200), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    rep: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "Única" },
    resp: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
    ok: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    doneOn: { type: DataTypes.DATEONLY, allowNull: true },
  },
  { tableName: "schedules", timestamps: true },
);

export const CorrectiveAction = sequelize.define(
  "CorrectiveAction",
  {
    ...commonFields(),
    desc: { type: DataTypes.TEXT, allowNull: false },
    resp: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
    due: { type: DataTypes.DATEONLY, allowNull: false },
    e: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Abierta" },
    cierre: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    rec: { type: DataTypes.STRING(80), allowNull: true },
    correction: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    cause: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    actionPlan: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    evidence: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    verification: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    closedBy: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
    closedOn: { type: DataTypes.DATEONLY, allowNull: true },
  },
  { tableName: "corrective_actions", timestamps: true },
);

export const MasterItem = sequelize.define(
  "MasterItem",
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    category: { type: DataTypes.STRING(40), allowNull: false },
    value: { type: DataTypes.STRING(200), allowNull: false },
    config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: "master_items",
    timestamps: true,
    indexes: [{ unique: true, fields: ["category", "value"] }],
  },
);

export const AppSetting = sequelize.define(
  "AppSetting",
  {
    key: { type: DataTypes.STRING(80), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
  },
  { tableName: "app_settings", timestamps: false },
);

export const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    passwordHash: { type: DataTypes.STRING(100), allowNull: false },
    role: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "user",
      validate: { isIn: [["super", "user_admin", "user"]] },
    },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: "users", timestamps: true },
);

export const DispatchProduct = sequelize.define("DispatchProduct", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING(160), allowNull: false },
  indirectPercentage: { type: DataTypes.DECIMAL(7, 4), allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  updatedBy: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: "dispatch_products",
  timestamps: true,
  indexes: [{ fields: ["active", "name"] }],
});

export const DispatchPresentation = sequelize.define("DispatchPresentation", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  productId: { type: DataTypes.UUID, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  productionCost: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  retailPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  wholesalePrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: "dispatch_presentations",
  timestamps: true,
  indexes: [{ unique: true, fields: ["productId", "name"] }, { fields: ["productId", "active"] }],
});

export const Dispatch = sequelize.define("Dispatch", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  dispatchNumber: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  idempotencyKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  customerName: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
  saleType: { type: DataTypes.ENUM("retail", "wholesale"), allowNull: false },
  totalAmount: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
  totalCost: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
  status: { type: DataTypes.ENUM("confirmed", "cancelled"), allowNull: false, defaultValue: "confirmed" },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  cancelledBy: { type: DataTypes.UUID, allowNull: true },
  cancelledAt: { type: DataTypes.DATE, allowNull: true },
  cancellationReason: { type: DataTypes.STRING(500), allowNull: true },
}, {
  tableName: "dispatches",
  timestamps: true,
  indexes: [{ fields: ["createdAt", "status"] }, { fields: ["createdBy"] }],
});

export const DispatchItem = sequelize.define("DispatchItem", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  dispatchId: { type: DataTypes.UUID, allowNull: false },
  productId: { type: DataTypes.UUID, allowNull: false },
  presentationId: { type: DataTypes.UUID, allowNull: false },
  productNameSnapshot: { type: DataTypes.STRING(160), allowNull: false },
  presentationNameSnapshot: { type: DataTypes.STRING(120), allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  unitPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  unitCost: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  subtotal: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
  totalCost: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
}, { tableName: "dispatch_items", timestamps: true, indexes: [{ fields: ["dispatchId"] }, { fields: ["productId"] }] });

DispatchProduct.hasMany(DispatchPresentation, { as: "presentations", foreignKey: "productId" });
DispatchPresentation.belongsTo(DispatchProduct, { as: "product", foreignKey: "productId" });
Dispatch.hasMany(DispatchItem, { as: "items", foreignKey: "dispatchId" });
DispatchItem.belongsTo(Dispatch, { as: "dispatch", foreignKey: "dispatchId" });
Dispatch.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
