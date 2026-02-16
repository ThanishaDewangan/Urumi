# System Design & Tradeoffs

Short note on architecture choices, idempotency/failure/cleanup, and what changes for production.

---

## Architecture choice

- **Namespace per store** – Each store gets its own Kubernetes namespace (`store-{id}`). This gives clear isolation, simple cleanup (delete namespace), and a natural place for per-store ResourceQuota and LimitRange. The downside is more namespaces and a bit more overhead than a single shared namespace.
- **Single backend for API + orchestration** – The same Node.js service exposes the REST API and performs provisioning. This keeps the system simple and avoids extra services for the MVP. For higher provisioning throughput, we’d split into API + queue + workers.
- **State in Kubernetes** – Store metadata (id, name, engine, status, timestamps) lives in namespace labels/annotations. No separate DB is required for the platform; state stays next to the resources and survives backend restarts.
- **Helm for deployment** – One chart with `values-local.yaml` and `values-prod.yaml` keeps local and VPS deployments consistent and makes env-specific choices (domain, TLS, storage, image pull) explicit.

---

## Idempotency, failure handling, and cleanup

- **Idempotency** – Every Kubernetes create (Namespace, Secret, PVC, Deployment, StatefulSet, Service, Ingress, ResourceQuota, LimitRange, NetworkPolicy) is wrapped so that 409 AlreadyExists is treated as success. Provisioning can be retried safely without creating duplicate resources.
- **Failure handling** – If provisioning throws, we catch it, log it, and patch the store namespace with `status=failed` and a reason. The dashboard shows this. A background status monitor also marks stores as failed when pods are unhealthy or when a provisioning timeout is exceeded.
- **Cleanup** – Deleting a store means deleting its namespace. Kubernetes cascading deletion removes all resources in that namespace (Pods, Services, Ingress, Secrets, PVCs, etc.). There are no separate cleanup jobs; we rely on namespace deletion for guarantees.

---

## What changes for production

| Area | Local | Production (e.g. VPS / k3s) |
|------|--------|-----------------------------|
| **DNS** | localtest.me or /etc/hosts | Real domain; A records for dashboard, api, and *.domain for stores |
| **Ingress** | HTTP, single host per service | HTTPS (e.g. cert-manager + Let’s Encrypt), same host pattern |
| **Storage class** | default or empty | e.g. local-path (k3s) or cloud StorageClass |
| **Secrets** | Generated in-cluster, stored in K8s Secrets | Same for MVP; production can use external secret manager (e.g. Vault, cloud secrets) and optionally rotation |
| **Images** | Built locally, loaded into cluster (e.g. kind load) | Built and pushed to a registry; imagePullPolicy IfNotPresent/Always |
| **Resources** | Often no requests/limits | Set requests/limits on platform and store workloads; use ResourceQuota per store |
| **Replicas** | 1 for dashboard/backend | 2+ for availability if desired |
| **Monitoring / logging** | Optional | Centralized logging and metrics (e.g. Prometheus, Grafana) recommended |

Upgrade/rollback is done with Helm: `helm upgrade` for releases, `helm rollback` to revert. Same chart, different values files for local vs prod.
