import { getK8sClients } from "../k8s/client";
import { config } from "../config";

interface Metrics {
  stores_total: number;
  stores_ready: number;
  stores_provisioning: number;
  stores_failed: number;
  stores_created_total: number;
  stores_deleted_total: number;
}

let storesCreatedTotal = 0;
let storesDeletedTotal = 0;

export function incrementStoresCreated() {
  storesCreatedTotal++;
}

export function incrementStoresDeleted() {
  storesDeletedTotal++;
}

export async function getMetrics(): Promise<Metrics> {
  const { core } = getK8sClients();
  const namespaces = await core.listNamespace();
  
  let storesTotal = 0;
  let storesReady = 0;
  let storesProvisioning = 0;
  let storesFailed = 0;

  for (const ns of namespaces.body.items) {
    const labels = ns.metadata?.labels || {};
    if (labels[config.storeLabelKey] === config.storeLabelValue) {
      storesTotal++;
      const annotations = ns.metadata?.annotations || {};
      const status = annotations["store.urumi.ai/status"];
      if (status === "ready") storesReady++;
      else if (status === "provisioning") storesProvisioning++;
      else if (status === "failed") storesFailed++;
    }
  }

  return {
    stores_total: storesTotal,
    stores_ready: storesReady,
    stores_provisioning: storesProvisioning,
    stores_failed: storesFailed,
    stores_created_total: storesCreatedTotal,
    stores_deleted_total: storesDeletedTotal
  };
}
