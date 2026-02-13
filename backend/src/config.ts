export const config = {
  port: Number(process.env.PORT || 4000),
  baseDomain: process.env.BASE_DOMAIN || "localtest.me",
  storeNamespacePrefix: process.env.STORE_NAMESPACE_PREFIX || "store-",
  storeLabelKey: process.env.STORE_LABEL_KEY || "store.urumi.ai/enabled",
  storeLabelValue: process.env.STORE_LABEL_VALUE || "true",
  storageClassName: process.env.STORAGE_CLASS_NAME || "",
  maxStores: Number(process.env.MAX_STORES || 100),
  provisioningTimeoutMinutes: Number(process.env.PROVISIONING_TIMEOUT_MINUTES || 10)
};

