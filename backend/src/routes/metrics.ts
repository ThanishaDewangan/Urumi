import { Router } from "express";
import { getMetrics } from "../services/metricsService";

export const metricsRouter = Router();

metricsRouter.get("/", async (_req, res, next) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});
