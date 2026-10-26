import { Router } from "express";
import { Op } from "sequelize";
import { Dispatch, DispatchItem, DispatchPresentation, DispatchProduct, User, sequelize } from "./database.js";
import { centsToMoney, moneyToCents, periodRange, totalUnitCostCents, validateDispatchInput } from "./dispatch-domain.js";

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const isFinancial = (req) => req.user?.role === "super";
const requireSuper = (req, res, next) => isFinancial(req) ? next() : res.status(403).json({ error: "You do not have permission for financial information." });
const productInclude = { model: DispatchPresentation, as: "presentations", required: false };
const cleanText = (value, max) => String(value || "").trim().slice(0, max);
const productJson = (product, includeCosts) => {
  const json = product.toJSON();
  return {
    id: json.id, name: json.name, active: json.active,
    ...(includeCosts ? { indirectPercentage: json.indirectPercentage } : {}),
    presentations: (json.presentations || []).map((item) => ({
      id: item.id, name: item.name, active: item.active, retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      ...(includeCosts ? { productionCost: item.productionCost } : {}),
    })),
  };
};

router.get("/dispatch-products", asyncRoute(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && isFinancial(req);
  const products = await DispatchProduct.findAll({
    where: includeInactive ? {} : { active: true },
    include: [{ ...productInclude, where: includeInactive ? undefined : { active: true } }],
    order: [["name", "ASC"], [{ model: DispatchPresentation, as: "presentations" }, "name", "ASC"]],
  });
  res.json(products.map((product) => productJson(product, isFinancial(req))));
}));

router.post("/dispatch-products", requireSuper, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 160);
  const indirectPercentage = Number(req.body.indirectPercentage);
  if (!name || !Number.isFinite(indirectPercentage) || indirectPercentage < 0 || indirectPercentage > 1000) return res.status(400).json({ error: "Invalid product data." });
  const presentations = Array.isArray(req.body.presentations) ? req.body.presentations : [];
  if (presentations.length > 50) return res.status(400).json({ error: "A product cannot have more than 50 presentations." });
  const normalized = presentations.map((item) => ({
    name: cleanText(item.name, 120), productionCost: moneyToCents(item.productionCost),
    retailPrice: moneyToCents(item.retailPrice), wholesalePrice: moneyToCents(item.wholesalePrice ?? 0),
    active: item.active !== false,
  }));
  if (normalized.some((item) => !item.name || item.productionCost == null || item.retailPrice == null || item.retailPrice <= 0 || item.wholesalePrice == null)) return res.status(400).json({ error: "Invalid presentation data." });
  const product = await sequelize.transaction(async (transaction) => {
    const created = await DispatchProduct.create({ name, indirectPercentage, active: req.body.active !== false, createdBy: req.user.id, updatedBy: req.user.id }, { transaction });
    if (normalized.length) await DispatchPresentation.bulkCreate(normalized.map((item) => ({ ...item, productId: created.id, productionCost: centsToMoney(item.productionCost), retailPrice: centsToMoney(item.retailPrice), wholesalePrice: centsToMoney(item.wholesalePrice) })), { transaction });
    return DispatchProduct.findByPk(created.id, { include: [productInclude], transaction });
  });
  res.status(201).json(productJson(product, true));
}));

router.put("/dispatch-products/:id", requireSuper, asyncRoute(async (req, res) => {
  const product = await DispatchProduct.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  const name = cleanText(req.body.name, 160);
  const indirectPercentage = Number(req.body.indirectPercentage);
  if (!name || !Number.isFinite(indirectPercentage) || indirectPercentage < 0 || indirectPercentage > 1000) return res.status(400).json({ error: "Invalid product data." });
  await product.update({ name, indirectPercentage, active: req.body.active !== false, updatedBy: req.user.id });
  res.json(productJson(product, true));
}));

router.delete("/dispatch-products/:id", requireSuper, asyncRoute(async (req, res) => {
  const product = await DispatchProduct.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  await sequelize.transaction(async (transaction) => {
    await product.update({ active: false, updatedBy: req.user.id }, { transaction });
    await DispatchPresentation.update({ active: false }, { where: { productId: product.id }, transaction });
  });
  res.status(204).end();
}));

router.post("/dispatch-products/:id/presentations", requireSuper, asyncRoute(async (req, res) => {
  const product = await DispatchProduct.findByPk(req.params.id);
  const name = cleanText(req.body.name, 120);
  const productionCost = moneyToCents(req.body.productionCost);
  const retailPrice = moneyToCents(req.body.retailPrice);
  const wholesalePrice = moneyToCents(req.body.wholesalePrice ?? 0);
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (!name || productionCost == null || retailPrice == null || wholesalePrice == null || retailPrice <= 0) return res.status(400).json({ error: "Invalid presentation data." });
  const presentation = await DispatchPresentation.create({ productId: product.id, name, productionCost: centsToMoney(productionCost), retailPrice: centsToMoney(retailPrice), wholesalePrice: centsToMoney(wholesalePrice) });
  res.status(201).json(presentation);
}));

router.put("/dispatch-presentations/:id", requireSuper, asyncRoute(async (req, res) => {
  const presentation = await DispatchPresentation.findByPk(req.params.id);
  const name = cleanText(req.body.name, 120);
  const productionCost = moneyToCents(req.body.productionCost);
  const retailPrice = moneyToCents(req.body.retailPrice);
  const wholesalePrice = moneyToCents(req.body.wholesalePrice ?? 0);
  if (!presentation) return res.status(404).json({ error: "Presentation not found." });
  if (!name || productionCost == null || retailPrice == null || wholesalePrice == null || retailPrice <= 0) return res.status(400).json({ error: "Invalid presentation data." });
  await presentation.update({ name, productionCost: centsToMoney(productionCost), retailPrice: centsToMoney(retailPrice), wholesalePrice: centsToMoney(wholesalePrice), active: req.body.active !== false });
  res.json(presentation);
}));

router.delete("/dispatch-presentations/:id", requireSuper, asyncRoute(async (req, res) => {
  const presentation = await DispatchPresentation.findByPk(req.params.id);
  if (!presentation) return res.status(404).json({ error: "Presentation not found." });
  await presentation.update({ active: false });
  res.status(204).end();
}));

function dispatchJson(record, financial) {
  const json = record.toJSON();
  if (!financial) {
    delete json.totalCost;
    for (const item of json.items || []) { delete item.unitCost; delete item.totalCost; }
  }
  return json;
}

router.post("/dispatches", asyncRoute(async (req, res) => {
  const validationError = validateDispatchInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const existing = await Dispatch.findOne({ where: { idempotencyKey: req.body.idempotencyKey }, include: [{ model: DispatchItem, as: "items" }] });
  if (existing) return res.json(dispatchJson(existing, isFinancial(req)));
  const grouped = new Map();
  for (const item of req.body.items) grouped.set(item.presentationId, (grouped.get(item.presentationId) || 0) + Number(item.quantity));
  const created = await sequelize.transaction(async (transaction) => {
    const presentations = await DispatchPresentation.findAll({ where: { id: [...grouped.keys()], active: true }, include: [{ model: DispatchProduct, as: "product", where: { active: true } }], transaction, lock: transaction.LOCK.UPDATE });
    if (presentations.length !== grouped.size) throw Object.assign(new Error("One or more presentations are unavailable."), { status: 409 });
    let amountCents = 0; let costCents = 0;
    const items = presentations.map((presentation) => {
      const quantity = grouped.get(presentation.id);
      const selected = req.body.saleType === "wholesale" && moneyToCents(presentation.wholesalePrice) > 0 ? presentation.wholesalePrice : presentation.retailPrice;
      const unitPrice = moneyToCents(selected);
      const unitCost = totalUnitCostCents(presentation.productionCost, presentation.product.indirectPercentage);
      amountCents += unitPrice * quantity; costCents += unitCost * quantity;
      return { productId: presentation.productId, presentationId: presentation.id, productNameSnapshot: presentation.product.name, presentationNameSnapshot: presentation.name, quantity, unitPrice: centsToMoney(unitPrice), unitCost: centsToMoney(unitCost), subtotal: centsToMoney(unitPrice * quantity), totalCost: centsToMoney(unitCost * quantity) };
    });
    const dispatch = await Dispatch.create({ dispatchNumber: `DL-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`, idempotencyKey: req.body.idempotencyKey, customerName: cleanText(req.body.customerName, 160), saleType: req.body.saleType, totalAmount: centsToMoney(amountCents), totalCost: centsToMoney(costCents), createdBy: req.user.id }, { transaction });
    await DispatchItem.bulkCreate(items.map((item) => ({ ...item, dispatchId: dispatch.id })), { transaction });
    return Dispatch.findByPk(dispatch.id, { include: [{ model: DispatchItem, as: "items" }], transaction });
  });
  res.status(201).json(dispatchJson(created, isFinancial(req)));
}));

router.get("/dispatches", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const where = {};
  if (req.query.status && ["confirmed", "cancelled"].includes(req.query.status)) where.status = req.query.status;
  if (req.query.from || req.query.to) where.createdAt = { ...(req.query.from ? { [Op.gte]: new Date(`${req.query.from}T00:00:00.000Z`) } : {}), ...(req.query.to ? { [Op.lt]: new Date(`${req.query.to}T00:00:00.000Z`) } : {}) };
  if (req.query.search) where[Op.or] = [{ dispatchNumber: { [Op.iLike]: `%${cleanText(req.query.search, 80)}%` } }, { customerName: { [Op.iLike]: `%${cleanText(req.query.search, 80)}%` } }];
  const result = await Dispatch.findAndCountAll({ where, include: [{ model: DispatchItem, as: "items" }, { model: User, as: "creator", attributes: ["id", "name", "username"] }], order: [["createdAt", "DESC"]], distinct: true, limit, offset: (page - 1) * limit });
  res.json({ rows: result.rows.map((row) => dispatchJson(row, isFinancial(req))), pagination: { page, limit, total: result.count, pages: Math.ceil(result.count / limit) } });
}));

router.get("/dispatches/:id", asyncRoute(async (req, res) => {
  const dispatch = await Dispatch.findByPk(req.params.id, { include: [{ model: DispatchItem, as: "items" }, { model: User, as: "creator", attributes: ["id", "name", "username"] }] });
  if (!dispatch) return res.status(404).json({ error: "Dispatch not found." });
  res.json(dispatchJson(dispatch, isFinancial(req)));
}));

router.post("/dispatches/:id/cancel", requireSuper, asyncRoute(async (req, res) => {
  const reason = cleanText(req.body.reason, 500);
  if (reason.length < 5) return res.status(400).json({ error: "A cancellation reason is required." });
  const dispatch = await Dispatch.findByPk(req.params.id);
  if (!dispatch) return res.status(404).json({ error: "Dispatch not found." });
  if (dispatch.status === "cancelled") return res.status(409).json({ error: "Dispatch is already cancelled." });
  await dispatch.update({ status: "cancelled", cancelledBy: req.user.id, cancelledAt: new Date(), cancellationReason: reason });
  res.json(dispatch);
}));

router.get("/dispatch-analytics/summary", requireSuper, asyncRoute(async (req, res) => {
  const range = periodRange(String(req.query.period || "month"), String(req.query.reference || ""));
  if (!range) return res.status(400).json({ error: "Invalid period or reference date." });
  const rows = await Dispatch.findAll({ where: { status: "confirmed", createdAt: { [Op.gte]: range.start, [Op.lt]: range.end } }, include: [{ model: DispatchItem, as: "items" }], order: [["createdAt", "ASC"]] });
  let sales = 0; let costs = 0; let units = 0; const products = new Map(); const buckets = new Map();
  for (const row of rows) {
    const amount = moneyToCents(row.totalAmount); const cost = moneyToCents(row.totalCost); sales += amount; costs += cost;
    const day = row.createdAt.toISOString().slice(0, 10); buckets.set(day, (buckets.get(day) || 0) + amount);
    for (const item of row.items) { units += item.quantity; const key = `${item.productNameSnapshot}|${item.presentationNameSnapshot}`; const current = products.get(key) || { productName: item.productNameSnapshot, presentationName: item.presentationNameSnapshot, quantity: 0, salesCents: 0, costCents: 0 }; current.quantity += item.quantity; current.salesCents += moneyToCents(item.subtotal); current.costCents += moneyToCents(item.totalCost); products.set(key, current); }
  }
  const profit = sales - costs;
  res.json({ summary: { sales: centsToMoney(sales), costs: centsToMoney(costs), profit: centsToMoney(profit), margin: sales ? Number((profit * 100 / sales).toFixed(2)) : 0, units, orders: rows.length, averageTicket: centsToMoney(rows.length ? Math.round(sales / rows.length) : 0) }, sales: [...buckets].map(([date, value]) => ({ date, value: centsToMoney(value) })), products: [...products.values()].sort((a, b) => b.salesCents - a.salesCents).map((item) => ({ ...item, sales: centsToMoney(item.salesCents), costs: centsToMoney(item.costCents), profit: centsToMoney(item.salesCents - item.costCents), margin: item.salesCents ? Number(((item.salesCents - item.costCents) * 100 / item.salesCents).toFixed(2)) : 0, share: sales ? Number((item.salesCents * 100 / sales).toFixed(2)) : 0, salesCents: undefined, costCents: undefined })) });
}));

export default router;
