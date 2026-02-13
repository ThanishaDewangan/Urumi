import { Router } from "express";
import { listStores, createStore, deleteStore } from "../services/storeService";
import { StoreEngine } from "../types/store";
import { getAuditLog, getAuditLogForStore } from "../services/auditLogger";

export const storesRouter = Router();

storesRouter.get("/", async (_req, res, next) => {
  try {
    const stores = await listStores();
    res.json(stores);
  } catch (err) {
    next(err);
  }
});

storesRouter.post("/", async (req, res, next) => {
  try {
    const { name, engine } = req.body as { name?: string; engine?: StoreEngine };
    const clientIp = req.ip || req.socket.remoteAddress || undefined;

    if (!engine || (engine !== "medusa" && engine !== "woocommerce")) {
      return res.status(400).json({ error: "engine must be 'medusa' or 'woocommerce'" });
    }

    const store = await createStore({
      name: name || "New Store",
      engine
    }, clientIp);

    res.status(201).json(store);
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

storesRouter.delete("/:id", async (req, res, next) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || undefined;
    await deleteStore(req.params.id, clientIp);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

storesRouter.get("/audit", async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const storeId = req.query.storeId as string | undefined;
    
    const auditLog = storeId 
      ? getAuditLogForStore(storeId)
      : getAuditLog(limit);
    
    res.json(auditLog);
  } catch (err) {
    next(err);
  }
});

