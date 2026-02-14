import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { storesRouter } from "./routes/stores";
import { startStatusMonitor } from "./services/statusMonitor";
import { metricsRouter } from "./routes/metrics";
import { domainsRouter } from "./routes/domains";

const app = express();

app.use(cors());
app.use(express.json());

// Rate limiting: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/stores", apiLimiter);
app.use("/stores", storesRouter);
app.use("/domains", domainsRouter);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/metrics", metricsRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

startStatusMonitor();

app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});

