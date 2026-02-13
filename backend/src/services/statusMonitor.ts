import { getK8sClients } from "../k8s/client";
import { config } from "../config";
import { StoreStatus } from "../types/store";
import { logAuditEvent } from "./auditLogger";

const STORE_STATUS_ANNOTATION = "store.urumi.ai/status";
const STORE_REASON_ANNOTATION = "store.urumi.ai/reason";
const STORE_UPDATED_AT_ANNOTATION = "store.urumi.ai/updated-at";
const STORE_CREATED_AT_ANNOTATION = "store.urumi.ai/created-at";
const STORE_NAME_ANNOTATION = "store.urumi.ai/name";
const STORE_ENGINE_ANNOTATION = "store.urumi.ai/engine";

function namespaceForStore(id: string): string {
  return `${config.storeNamespacePrefix}${id}`;
}

async function checkStoreHealth(nsName: string): Promise<{ status: StoreStatus; reason?: string }> {
  const { core, apps } = getK8sClients();

  try {
    const deployments = await apps.listNamespacedDeployment(nsName);
    const statefulsets = await apps.listNamespacedStatefulSet(nsName);

    for (const deploy of deployments.body.items) {
      const ready = deploy.status?.readyReplicas || 0;
      const desired = deploy.spec?.replicas || 1;
      if (ready < desired) {
        return { status: "provisioning", reason: `Deployment ${deploy.metadata?.name} not ready (${ready}/${desired})` };
      }
    }

    for (const sts of statefulsets.body.items) {
      const ready = sts.status?.readyReplicas || 0;
      const desired = sts.spec?.replicas || 1;
      if (ready < desired) {
        return { status: "provisioning", reason: `StatefulSet ${sts.metadata?.name} not ready (${ready}/${desired})` };
      }
    }

    const pods = await core.listNamespacedPod(nsName);
    for (const pod of pods.body.items) {
      const phase = pod.status?.phase;
      if (phase === "Failed" || phase === "Unknown") {
        return { status: "failed", reason: `Pod ${pod.metadata?.name} in ${phase} state` };
      }
      if (phase !== "Running") {
        return { status: "provisioning", reason: `Pod ${pod.metadata?.name} in ${phase} state` };
      }
      
      // Check if pod is actually ready (readiness probe passed)
      const readyCondition = pod.status?.conditions?.find(c => c.type === "Ready");
      if (!readyCondition || readyCondition.status !== "True") {
        const reason = readyCondition?.reason || "Readiness probe not passed";
        return { status: "provisioning", reason: `Pod ${pod.metadata?.name} not ready: ${reason}` };
      }
    }

    return { status: "ready" };
  } catch (err: any) {
    if (err.response?.statusCode === 404) {
      return { status: "failed", reason: "Namespace not found" };
    }
    return { status: "provisioning", reason: "Checking resources..." };
  }
}

export async function updateStoreStatus(storeId: string): Promise<void> {
  const { core } = getK8sClients();
  const nsName = namespaceForStore(storeId);

  try {
    const ns = await core.readNamespace(nsName);
    const nsAnnotations = ns.body.metadata?.annotations || {};
    const currentStatus = nsAnnotations[STORE_STATUS_ANNOTATION];
    const createdAt = nsAnnotations[STORE_CREATED_AT_ANNOTATION];
    const storeName = nsAnnotations[STORE_NAME_ANNOTATION];
    const engine = nsAnnotations[STORE_ENGINE_ANNOTATION];

    if (currentStatus === "ready" || currentStatus === "failed") {
      return;
    }

    // Check provisioning timeout
    if (createdAt) {
      const createdTime = new Date(createdAt).getTime();
      const now = Date.now();
      const timeoutMs = config.provisioningTimeoutMinutes * 60 * 1000;
      
      if (now - createdTime > timeoutMs) {
        const timeoutReason = `Provisioning timeout after ${config.provisioningTimeoutMinutes} minutes`;
        const updatedAnnotations = { ...nsAnnotations };
        updatedAnnotations[STORE_STATUS_ANNOTATION] = "failed";
        updatedAnnotations[STORE_REASON_ANNOTATION] = timeoutReason;
        updatedAnnotations[STORE_UPDATED_AT_ANNOTATION] = new Date().toISOString();
        
        await core.patchNamespace(nsName, {
          metadata: { annotations: updatedAnnotations }
        }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
        
        logAuditEvent({
          action: "store.provisioning.failed",
          storeId,
          storeName,
          engine,
          reason: timeoutReason
        });
        return;
      }
    }

    const { status, reason } = await checkStoreHealth(nsName);

    const finalAnnotations = { ...nsAnnotations };
    finalAnnotations[STORE_STATUS_ANNOTATION] = status;
    finalAnnotations[STORE_UPDATED_AT_ANNOTATION] = new Date().toISOString();
    if (reason) {
      finalAnnotations[STORE_REASON_ANNOTATION] = reason;
    } else {
      delete finalAnnotations[STORE_REASON_ANNOTATION];
    }

    await core.patchNamespace(nsName, {
      metadata: { annotations: finalAnnotations }
    }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
  } catch (err: any) {
    if (err.response?.statusCode !== 404) {
      console.error(`Failed to update status for store ${storeId}:`, err.message);
    }
  }
}

export function startStatusMonitor(): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const { core } = getK8sClients();
      const namespaces = await core.listNamespace();

      for (const ns of namespaces.body.items) {
        const labels = ns.metadata?.labels || {};
        const annotations = ns.metadata?.annotations || {};
        
        if (labels[config.storeLabelKey] === config.storeLabelValue) {
          const storeId = annotations["store.urumi.ai/id"] || ns.metadata?.name?.replace(config.storeNamespacePrefix, "") || "";
          if (storeId) {
            await updateStoreStatus(storeId);
          }
        }
      }
    } catch (err: any) {
      console.error("Status monitor error:", err.message);
    }
  }, 10000);
}
