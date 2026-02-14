import { v4 as uuidv4 } from "uuid";
import { V1Namespace, V1ObjectMeta } from "@kubernetes/client-node";
import { getK8sClients } from "../k8s/client";
import { config } from "../config";
import { Store, StoreEngine, StoreStatus } from "../types/store";
import { createMedusaResources } from "./medusaProvisioner";
import { logAuditEvent } from "./auditLogger";
import { incrementStoresCreated, incrementStoresDeleted } from "./metricsService";
import { acquireProvisioningLock, releaseProvisioningLock } from "./provisioningLock";

const STORE_ID_ANNOTATION = "store.urumi.ai/id";
const STORE_NAME_ANNOTATION = "store.urumi.ai/name";
const STORE_ENGINE_ANNOTATION = "store.urumi.ai/engine";
const STORE_CREATED_AT_ANNOTATION = "store.urumi.ai/created-at";
const STORE_UPDATED_AT_ANNOTATION = "store.urumi.ai/updated-at";
const STORE_STATUS_ANNOTATION = "store.urumi.ai/status";
const STORE_REASON_ANNOTATION = "store.urumi.ai/reason";

function namespaceForStore(id: string): string {
  return `${config.storeNamespacePrefix}${id}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildStoreFromNamespace(ns: V1Namespace): Store | null {
  const meta = ns.metadata as V1ObjectMeta;
  const labels = meta.labels || {};
  const annotations = meta.annotations || {};

  if (!labels[config.storeLabelKey]) return null;

  const id = annotations[STORE_ID_ANNOTATION] || meta.name?.replace(config.storeNamespacePrefix, "") || "";
  const name = annotations[STORE_NAME_ANNOTATION] || id;
  const engine = (annotations[STORE_ENGINE_ANNOTATION] as StoreEngine) || "medusa";
  const createdAt = annotations[STORE_CREATED_AT_ANNOTATION] || nowIso();
  const updatedAt = annotations[STORE_UPDATED_AT_ANNOTATION] || createdAt;
  const status = (annotations[STORE_STATUS_ANNOTATION] as StoreStatus) || "provisioning";
  const reason = annotations[STORE_REASON_ANNOTATION];

  const baseDomain = config.baseDomain;
  const sub = `store-${id}`;
  const storefrontUrl = `https://${sub}.${baseDomain}`;
  const adminUrl = `https://admin-${id}.${baseDomain}`;
  const apiUrl = `https://api-${id}.${baseDomain}`;

  return {
    id,
    name,
    engine,
    status,
    createdAt,
    updatedAt,
    storefrontUrl,
    adminUrl,
    apiUrl,
    reason
  };
}

export async function listStores(): Promise<Store[]> {
  const { core } = getK8sClients();
  const res = await core.listNamespace();
  const stores: Store[] = [];
  for (const ns of res.body.items) {
    const s = buildStoreFromNamespace(ns);
    if (s) stores.push(s);
  }
  return stores;
}

interface CreateStoreInput {
  name: string;
  engine: StoreEngine;
}

export async function createStore(input: CreateStoreInput, clientIp?: string): Promise<Store> {
  const { core } = getK8sClients();

  if (input.engine === "woocommerce") {
    throw Object.assign(new Error("WooCommerce engine is not yet implemented"), { statusCode: 400 });
  }

  // Check max stores limit
  const existingStores = await listStores();
  if (existingStores.length >= config.maxStores) {
    throw Object.assign(
      new Error(`Maximum store limit reached (${config.maxStores}). Please delete some stores before creating new ones.`),
      { statusCode: 429 }
    );
  }

  const id = uuidv4().split("-")[0];
  const nsName = namespaceForStore(id);
  const now = nowIso();

  // Try to acquire provisioning lock to prevent race conditions
  const lockHandle = await acquireProvisioningLock(id, clientIp);
  
  // Ensure lock is released on exit
  let lockReleased = false;
  const releaseLock = async () => {
    if (!lockReleased) {
      lockReleased = true;
      await releaseProvisioningLock(id);
    }
  };

  const ns: V1Namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: nsName,
      labels: {
        [config.storeLabelKey]: config.storeLabelValue
      },
      annotations: {
        [STORE_ID_ANNOTATION]: id,
        [STORE_NAME_ANNOTATION]: input.name || id,
        [STORE_ENGINE_ANNOTATION]: input.engine,
        [STORE_CREATED_AT_ANNOTATION]: now,
        [STORE_UPDATED_AT_ANNOTATION]: now,
        [STORE_STATUS_ANNOTATION]: "provisioning"
      }
    }
  };

  try {
    await core.createNamespace(ns);
  } catch (err: any) {
    await releaseLock();
    if (err.response?.statusCode === 409) {
      throw Object.assign(new Error("Store namespace already exists"), { statusCode: 409 });
    }
    throw err;
  }

  try {
    await createMedusaResources(nsName, id);
    incrementStoresCreated();
    logAuditEvent({
      action: "store.created",
      storeId: id,
      storeName: input.name,
      engine: input.engine,
      ip: clientIp
    });
  } catch (err: any) {
    console.error(`Failed to provision store ${id}:`, err);
    const errorMessage = err.message || "Provisioning failed";
    try {
      const ns = await core.readNamespace(nsName);
      const annotations = ns.body.metadata?.annotations || {};
      annotations[STORE_STATUS_ANNOTATION] = "failed";
      annotations[STORE_REASON_ANNOTATION] = errorMessage;
      annotations[STORE_UPDATED_AT_ANNOTATION] = nowIso();
      await core.patchNamespace(nsName, {
        metadata: { annotations }
      }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
      
      logAuditEvent({
        action: "store.provisioning.failed",
        storeId: id,
        storeName: input.name,
        engine: input.engine,
        reason: errorMessage,
        ip: clientIp
      });
    } catch (updateErr) {
      console.error(`Failed to update status for failed store ${id}:`, updateErr);
    }
    await releaseLock();
    throw err;
  }

  // Release lock and return store
  await releaseLock();
  
  const created = await core.readNamespace(nsName);
  const store = buildStoreFromNamespace(created.body);
  if (!store) {
    throw new Error("Failed to build store from namespace");
  }
  return store;
}

export async function deleteStore(id: string, clientIp?: string): Promise<void> {
  const { core } = getK8sClients();
  const nsName = namespaceForStore(id);
  
  // Get store info before deletion for audit log
  let storeName: string | undefined;
  try {
    const ns = await core.readNamespace(nsName);
    const annotations = ns.body.metadata?.annotations || {};
    storeName = annotations[STORE_NAME_ANNOTATION];
  } catch (err) {
    // Namespace might not exist, continue with deletion
  }
  
  try {
    await core.deleteNamespace(nsName);
    incrementStoresDeleted();
    logAuditEvent({
      action: "store.deleted",
      storeId: id,
      storeName,
      ip: clientIp
    });
  } catch (err: any) {
    if (err.response?.statusCode === 404) {
      return;
    }
    throw err;
  }
}

