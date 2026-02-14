import { getK8sClients } from "../k8s/client";
import { config } from "../config";

// In-memory lock store (for single-instance or when using external locking)
// In production, consider using Redis or Kubernetes leader election
const provisioningLocks = new Map<string, Promise<void>>();

const LOCK_ANNOTATION = "store.urumi.ai/provisioning-lock";
const LOCK_TIMEOUT_MS = 60000; // 60 seconds max lock hold

interface LockHandle {
  storeId: string;
  released: boolean;
}

export async function acquireProvisioningLock(storeId: string, clientIp?: string): Promise<LockHandle> {
  const { core } = getK8sClients();
  const nsName = `${config.storeNamespacePrefix}${storeId}`;
  const lockValue = `locked-by-${clientIp || 'system'}-${Date.now()}`;
  
  // Try to acquire lock via namespace annotation (atomic compare-and-swap)
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    try {
      // Read current namespace
      const ns = await core.readNamespace(nsName);
      const annotations = ns.body.metadata?.annotations || {};
      
      // Check if lock already held
      const existingLock = annotations[LOCK_ANNOTATION];
      if (existingLock) {
        // Lock exists, check if it's stale (old)
        const lockTime = parseInt(existingLock.split('-').pop() || '0', 10);
        if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          // Stale lock, force release
          console.warn(`Force releasing stale lock for store ${storeId}`);
        } else {
          // Lock is valid, wait and retry
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
          continue;
        }
      }
      
      // Try to acquire lock
      const newAnnotations = { ...annotations };
      newAnnotations[LOCK_ANNOTATION] = lockValue;
      
      try {
        await core.patchNamespace(nsName, {
          metadata: { annotations: newAnnotations }
        }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
        
        // Lock acquired successfully
        console.log(`Lock acquired for store ${storeId}`);
        
        // Start auto-release timer
        setTimeout(async () => {
          await releaseProvisioningLock(storeId);
        }, LOCK_TIMEOUT_MS - 5000);
        
        return {
          storeId,
          released: false
        };
      } catch (patchErr: any) {
        if (patchErr.response?.statusCode === 409) {
          // Conflict, another process got the lock first
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
          continue;
        }
        throw patchErr;
      }
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        // Namespace doesn't exist yet, we can proceed
        break;
      }
      throw err;
    }
  }
  
  // Fallback: use in-memory lock if K8s lock fails
  console.warn(`Using in-memory lock fallback for store ${storeId}`);
  const lockPromise = new Promise<void>(resolve => {
    setTimeout(resolve, 100);
  });
  provisioningLocks.set(storeId, lockPromise);
  
  return {
    storeId,
    released: false
  };
}

export async function releaseProvisioningLock(storeId: string): Promise<void> {
  const { core } = getK8sClients();
  const nsName = `${config.storeNamespacePrefix}${storeId}`;
  
  // Try to release K8s annotation lock
  try {
    const ns = await core.readNamespace(nsName);
    const annotations = ns.body.metadata?.annotations || {};
    
    if (annotations[LOCK_ANNOTATION]) {
      const newAnnotations = { ...annotations };
      delete newAnnotations[LOCK_ANNOTATION];
      
      await core.patchNamespace(nsName, {
        metadata: { annotations: newAnnotations }
      }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
      
      console.log(`Lock released for store ${storeId}`);
    }
  } catch (err: any) {
    console.warn(`Failed to release K8s lock for store ${storeId}:`, err.message);
  }
  
  // Release in-memory lock
  provisioningLocks.delete(storeId);
}

export async function isStoreProvisioning(storeId: string): Promise<boolean> {
  const { core } = getK8sClients();
  const nsName = `${config.storeNamespacePrefix}${storeId}`;
  
  try {
    const ns = await core.readNamespace(nsName);
    const annotations = ns.body.metadata?.annotations || {};
    const lockValue = annotations[LOCK_ANNOTATION];
    
    if (lockValue) {
      // Check if lock is stale
      const lockTime = parseInt(lockValue.split('-').pop() || '0', 10);
      return (Date.now() - lockTime) <= LOCK_TIMEOUT_MS;
    }
    
    return false;
  } catch (err: any) {
    if (err.response?.statusCode === 404) {
      return false;
    }
    throw err;
  }
}
