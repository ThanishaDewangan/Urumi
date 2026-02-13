export type StoreEngine = "medusa" | "woocommerce";

export type StoreStatus = "provisioning" | "ready" | "failed" | "deleting";

export interface Store {
  id: string;
  name: string;
  engine: StoreEngine;
  status: StoreStatus;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  storefrontUrl?: string;
  adminUrl?: string;
  apiUrl?: string;
  reason?: string; // failure reason if status === "failed"
}

