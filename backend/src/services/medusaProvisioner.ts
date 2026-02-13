import {
  V1Deployment,
  V1LimitRange,
  V1LimitRangeSpec,
  V1NetworkPolicy,
  V1NetworkPolicySpec,
  V1PersistentVolumeClaim,
  V1PersistentVolumeClaimSpec,
  V1ResourceQuota,
  V1ResourceQuotaSpec,
  V1Secret,
  V1SecurityContext,
  V1Service,
  V1StatefulSet,
  V1StatefulSetSpec
} from "@kubernetes/client-node";
import { getK8sClients } from "../k8s/client";
import { config } from "../config";
import { randomBytes } from "crypto";

const MEDUSA_API_IMAGE = process.env.MEDUSA_API_IMAGE || "nginx:alpine";
const MEDUSA_STOREFRONT_IMAGE = process.env.MEDUSA_STOREFRONT_IMAGE || "nginx:alpine";
const POSTGRES_IMAGE = process.env.POSTGRES_IMAGE || "postgres:15-alpine";

function generatePassword(): string {
  return randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
}

// Security context for non-root containers
const nonRootSecurityContext: V1SecurityContext = {
  allowPrivilegeEscalation: false,
  runAsNonRoot: true,
  runAsUser: 1000,
  capabilities: {
    drop: ["ALL"]
  }
};

export async function createMedusaResources(nsName: string, storeId: string) {
  const { core, apps, networking } = getK8sClients();

  // Create ResourceQuota to limit resources per store
  const resourceQuota: V1ResourceQuota = {
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: { name: "store-quota" },
    spec: {
      hard: {
        "requests.cpu": "2",
        "requests.memory": "4Gi",
        "limits.cpu": "4",
        "limits.memory": "8Gi",
        "persistentvolumeclaims": "3",
        "requests.storage": "10Gi"
      }
    } as V1ResourceQuotaSpec
  };

  try {
    await core.createNamespacedResourceQuota(nsName, resourceQuota);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  // Create LimitRange for default resource requests/limits
  const limitRange: V1LimitRange = {
    apiVersion: "v1",
    kind: "LimitRange",
    metadata: { name: "store-limits" },
    spec: {
      limits: [
        {
          _default: {
            cpu: "500m",
            memory: "512Mi"
          },
          defaultRequest: {
            cpu: "100m",
            memory: "128Mi"
          },
          type: "Container"
        }
      ]
    } as V1LimitRangeSpec
  };

  try {
    await core.createNamespacedLimitRange(nsName, limitRange);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  // Create NetworkPolicy for deny-by-default with required allows
  // Note: This is a basic policy - in production, you'd customize based on ingress controller namespace
  const networkPolicy: V1NetworkPolicy = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "store-network-policy" },
    spec: {
      podSelector: {}, // Applies to all pods in namespace
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        // Allow all ingress (for ingress controller and same namespace)
        {
          from: []
        }
      ],
      egress: [
        // Allow all egress (for DNS, external APIs, same namespace)
        {
          to: []
        }
      ]
    } as V1NetworkPolicySpec
  };

  try {
    await networking.createNamespacedNetworkPolicy(nsName, networkPolicy);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const dbPassword = generatePassword();
  const secret: V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "postgres-credentials" },
    type: "Opaque",
    stringData: {
      POSTGRES_DB: "medusa",
      POSTGRES_USER: "medusa",
      POSTGRES_PASSWORD: dbPassword,
      DATABASE_URL: `postgres://medusa:${dbPassword}@postgres:5432/medusa`
    }
  };

  try {
    await core.createNamespacedSecret(nsName, secret);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const pvc: V1PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: "postgres-data"
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: config.storageClassName || undefined,
      resources: {
        requests: {
          storage: "5Gi"
        }
      }
    } as V1PersistentVolumeClaimSpec
  };

  try {
    await core.createNamespacedPersistentVolumeClaim(nsName, pvc);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const postgres: V1StatefulSet = {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: "postgres" },
    spec: {
      serviceName: "postgres",
      replicas: 1,
      selector: { matchLabels: { app: "postgres" } },
      template: {
        metadata: { labels: { app: "postgres" } },
        spec: {
          containers: [
            {
              name: "postgres",
              image: POSTGRES_IMAGE,
              env: [
                { name: "POSTGRES_DB", valueFrom: { secretKeyRef: { name: "postgres-credentials", key: "POSTGRES_DB" } } },
                { name: "POSTGRES_USER", valueFrom: { secretKeyRef: { name: "postgres-credentials", key: "POSTGRES_USER" } } },
                { name: "POSTGRES_PASSWORD", valueFrom: { secretKeyRef: { name: "postgres-credentials", key: "POSTGRES_PASSWORD" } } }
              ],
              ports: [{ containerPort: 5432 }],
              volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data" }],
              resources: {
                requests: {
                  cpu: "250m",
                  memory: "512Mi"
                },
                limits: {
                  cpu: "1000m",
                  memory: "2Gi"
                }
              },
              readinessProbe: {
                exec: { command: ["pg_isready", "-U", "medusa"] },
                initialDelaySeconds: 5,
                periodSeconds: 5
              },
              livenessProbe: {
                exec: { command: ["pg_isready", "-U", "medusa"] },
                initialDelaySeconds: 30,
                periodSeconds: 10
              }
              // Note: Postgres runs as postgres user (UID 999), so we don't override security context
            }
          ]
        }
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: pvc.spec
        }
      ]
    } as V1StatefulSetSpec
  };

  try {
    await apps.createNamespacedStatefulSet(nsName, postgres);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const postgresSvc: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "postgres" },
    spec: {
      selector: { app: "postgres" },
      ports: [{ port: 5432, targetPort: 5432 }]
    }
  };

  try {
    await core.createNamespacedService(nsName, postgresSvc);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const medusaApi: V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "medusa-api" },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "medusa-api" } },
      template: {
        metadata: { labels: { app: "medusa-api" } },
        spec: {
          containers: [
            {
              name: "medusa-api",
              image: MEDUSA_API_IMAGE,
              env: [
                { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: "postgres-credentials", key: "DATABASE_URL" } } },
                { name: "NODE_ENV", value: "production" }
              ],
              ports: [{ containerPort: 80 }],
              resources: {
                requests: {
                  cpu: "200m",
                  memory: "256Mi"
                },
                limits: {
                  cpu: "500m",
                  memory: "1Gi"
                }
              },
              securityContext: nonRootSecurityContext,
              readinessProbe: {
                httpGet: { path: "/", port: 80 },
                initialDelaySeconds: 10,
                periodSeconds: 5,
                failureThreshold: 3
              },
              livenessProbe: {
                httpGet: { path: "/", port: 80 },
                initialDelaySeconds: 30,
                periodSeconds: 10
              }
            }
          ]
        }
      }
    }
  };

  try {
    await apps.createNamespacedDeployment(nsName, medusaApi);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const medusaApiSvc: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "medusa-api" },
    spec: {
      selector: { app: "medusa-api" },
      ports: [{ port: 80, targetPort: 80 }]
    }
  };

  try {
    await core.createNamespacedService(nsName, medusaApiSvc);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const medusaStorefront: V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "medusa-storefront" },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "medusa-storefront" } },
      template: {
        metadata: { labels: { app: "medusa-storefront" } },
        spec: {
          containers: [
            {
              name: "medusa-storefront",
              image: MEDUSA_STOREFRONT_IMAGE,
              env: [{ name: "MEDUSA_BACKEND_URL", value: "http://medusa-api" }],
              ports: [{ containerPort: 80 }],
              resources: {
                requests: {
                  cpu: "100m",
                  memory: "128Mi"
                },
                limits: {
                  cpu: "300m",
                  memory: "512Mi"
                }
              },
              securityContext: nonRootSecurityContext,
              readinessProbe: {
                httpGet: { path: "/", port: 80 },
                initialDelaySeconds: 10,
                periodSeconds: 5
              },
              livenessProbe: {
                httpGet: { path: "/", port: 80 },
                initialDelaySeconds: 30,
                periodSeconds: 10
              }
            }
          ]
        }
      }
    }
  };

  try {
    await apps.createNamespacedDeployment(nsName, medusaStorefront);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const medusaStorefrontSvc: V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "medusa-storefront" },
    spec: {
      selector: { app: "medusa-storefront" },
      ports: [{ port: 80, targetPort: 80 }]
    }
  };

  try {
    await core.createNamespacedService(nsName, medusaStorefrontSvc);
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  const base = config.baseDomain;
  const storeHost = `store-${storeId}.${base}`;
  const apiHost = `api-${storeId}.${base}`;

  try {
    await networking.createNamespacedIngress(nsName, {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "medusa-storefront" },
      spec: {
        rules: [
          {
            host: storeHost,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: { name: "medusa-storefront", port: { number: 80 } }
                  }
                }
              ]
            }
          }
        ]
      }
    });
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }

  try {
    await networking.createNamespacedIngress(nsName, {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "medusa-api" },
      spec: {
        rules: [
          {
            host: apiHost,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: { name: "medusa-api", port: { number: 80 } }
                  }
                }
              ]
            }
          }
        ]
      }
    });
  } catch (err: any) {
    if (err.response?.statusCode !== 409) throw err;
  }
}

