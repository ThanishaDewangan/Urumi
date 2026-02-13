# Architecture Diagrams

Visual diagrams for demo video and presentations.

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Browser                          │
│                    http://dashboard.localtest.me                │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/REST
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                           │
│                                                                 │
│  ┌──────────────────┐              ┌──────────────────────┐   │
│  │   Dashboard      │              │   Backend API &      │   │
│  │   (React SPA)    │◄────────────►│   Orchestrator       │   │
│  │                  │   REST API   │   (Node.js)          │   │
│  └──────────────────┘              └──────────┬───────────┘   │
│         │                                      │               │
│         │                                      │ Kubernetes    │
│         │                                      │ API Client    │
│         ▼                                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Ingress Controller (nginx)                  │ │
│  │  Routes: dashboard.*, api.*, store-*.*, api-*.*         │ │
│  └──────────────────────────────────────────────────────────┘ │
│         │                                      │               │
│         │                                      ▼               │
│         │              ┌───────────────────────────────────┐  │
│         │              │  Store Namespaces (Isolated)      │  │
│         │              │                                   │  │
│         │              │  ┌─────────────────────────────┐ │  │
│         │              │  │ Namespace: store-abc123     │ │  │
│         │              │  │                             │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Postgres StatefulSet │  │ │  │
│         │              │  │  │ + PVC (5Gi)          │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Medusa API           │  │ │  │
│         │              │  │  │ Deployment           │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Medusa Storefront    │  │ │  │
│         │              │  │  │ Deployment           │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Services (ClusterIP) │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Ingress Rules        │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  │  ┌──────────────────────┐  │ │  │
│         │              │  │  │ Secrets (DB creds)   │  │ │  │
│         │              │  │  └──────────────────────┘  │ │  │
│         │              │  └─────────────────────────────┘ │  │
│         │              │                                   │  │
│         │              │  ┌─────────────────────────────┐ │  │
│         │              │  │ Namespace: store-def456     │ │  │
│         │              │  │ (same structure...)         │ │  │
│         │              │  └─────────────────────────────┘ │  │
│         │              └───────────────────────────────────┘  │
│         │                                                     │
│         └─────────────────────────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Store Creation Flow

```
┌──────┐                ┌───────────┐              ┌─────────────┐
│ User │                │ Dashboard │              │   Backend   │
└──┬───┘                └─────┬─────┘              └──────┬──────┘
   │                          │                           │
   │ 1. Click "Create Store"  │                           │
   │─────────────────────────►│                           │
   │                          │                           │
   │                          │ 2. POST /stores           │
   │                          │  {name, engine}           │
   │                          │──────────────────────────►│
   │                          │                           │
   │                          │                           │ 3. Generate UUID
   │                          │                           │    Create namespace
   │                          │                           │
   │                          │                           ▼
   │                          │                    ┌──────────────┐
   │                          │                    │ Kubernetes   │
   │                          │                    │ API          │
   │                          │                    └──────┬───────┘
   │                          │                           │
   │                          │                           │ 4. Create resources:
   │                          │                           │    - Secret
   │                          │                           │    - PVC
   │                          │                           │    - StatefulSet
   │                          │                           │    - Deployments
   │                          │                           │    - Services
   │                          │                           │    - Ingress
   │                          │                           │
   │                          │ 5. Return store object    │
   │                          │◄──────────────────────────│
   │                          │   {id, status: provisioning}
   │                          │                           │
   │ 6. Show store            │                           │
   │    (status: provisioning)│                           │
   │◄─────────────────────────│                           │
   │                          │                           │
   │                          │                           │ 7. Status Monitor
   │                          │                           │    (every 10s)
   │                          │                           │    Check pods
   │                          │                           │
   │                          │                           │ 8. All pods ready?
   │                          │                           │    Update annotation
   │                          │                           │    status: ready
   │                          │                           │
   │ 9. Poll /stores          │                           │
   │    (every 5s)            │                           │
   │─────────────────────────►│                           │
   │                          │                           │
   │                          │ 10. GET /stores           │
   │                          │───────────────────────────►│
   │                          │                           │
   │                          │ 11. Return stores         │
   │                          │    [{id, status: ready}]  │
   │                          │◄──────────────────────────│
   │                          │                           │
   │ 12. Show store           │                           │
   │     (status: ready)      │                           │
   │◄─────────────────────────│                           │
   │                          │                           │
```

## Store Namespace Isolation

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Namespace: store-abc123                                   │ │
│  │ Labels: store.urumi.ai/enabled=true                       │ │
│  │ Annotations:                                              │ │
│  │   - store.urumi.ai/id: abc123                            │ │
│  │   - store.urumi.ai/name: "My Store"                      │ │
│  │   - store.urumi.ai/engine: medusa                        │ │
│  │   - store.urumi.ai/status: ready                         │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Secret: postgres-credentials                        │ │ │
│  │  │   POSTGRES_PASSWORD: <random-20-chars>              │ │ │
│  │  │   DATABASE_URL: postgres://...                      │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ PVC: postgres-data-postgres-0                       │ │ │
│  │  │   Size: 5Gi                                         │ │ │
│  │  │   StorageClass: local-path                          │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ StatefulSet: postgres                               │ │ │
│  │  │   Replicas: 1                                       │ │ │
│  │  │   Image: postgres:15-alpine                         │ │ │
│  │  │   Volume: postgres-data                             │ │ │
│  │  │   Probes: readiness, liveness                       │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Deployment: medusa-api                              │ │ │
│  │  │   Replicas: 1                                       │ │ │
│  │  │   Image: medusajs/medusa                            │ │ │
│  │  │   Env: DATABASE_URL (from Secret)                   │ │ │
│  │  │   Probes: readiness, liveness                       │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Deployment: medusa-storefront                       │ │ │
│  │  │   Replicas: 1                                       │ │ │
│  │  │   Image: medusajs/storefront                        │ │ │
│  │  │   Env: MEDUSA_BACKEND_URL=http://medusa-api        │ │ │
│  │  │   Probes: readiness, liveness                       │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Service: postgres (ClusterIP)                       │ │ │
│  │  │   Port: 5432 → postgres:5432                        │ │ │
│  │  │   Internal only (no Ingress)                        │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Service: medusa-api (ClusterIP)                     │ │ │
│  │  │   Port: 80 → medusa-api:9000                        │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Service: medusa-storefront (ClusterIP)              │ │ │
│  │  │   Port: 80 → medusa-storefront:80                   │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Ingress: medusa-storefront                          │ │ │
│  │  │   Host: store-abc123.localtest.me                   │ │ │
│  │  │   Path: / → medusa-storefront:80                    │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Ingress: medusa-api                                 │ │ │
│  │  │   Host: api-abc123.localtest.me                     │ │ │
│  │  │   Path: / → medusa-api:80                           │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Namespace: store-def456                                   │ │
│  │ (Completely isolated - separate resources)                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## RBAC Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Backend Pod                                               │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ ServiceAccount: backend                             │ │ │
│  │  │   Mounted token for K8s API authentication          │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                          │                                │ │
│  │                          │ bound to                       │ │
│  │                          ▼                                │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ ClusterRole: store-orchestrator                     │ │ │
│  │  │                                                     │ │ │
│  │  │ Permissions:                                        │ │ │
│  │  │   - namespaces: get, list, create, delete, patch   │ │ │
│  │  │   - secrets: get, list, create, delete             │ │ │
│  │  │   - services: get, list, create, delete            │ │ │
│  │  │   - pvcs: get, list, create, delete                │ │ │
│  │  │   - deployments: get, list, create, delete         │ │ │
│  │  │   - statefulsets: get, list, create, delete        │ │ │
│  │  │   - ingresses: get, list, create, delete           │ │ │
│  │  │   - pods: get, list (for status monitoring)        │ │ │
│  │  │                                                     │ │ │
│  │  │ NOT allowed:                                        │ │ │
│  │  │   - cluster-admin                                   │ │ │
│  │  │   - modify other namespaces                         │ │ │
│  │  │   - modify RBAC resources                           │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Store Pods (in store-* namespaces)                        │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ ServiceAccount: default                             │ │ │
│  │  │   No special permissions                            │ │ │
│  │  │   Cannot access K8s API                             │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Horizontal Scaling Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Production Scaling                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Dashboard Pods (Stateless - Scales Horizontally)          │ │
│  │                                                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │Dashboard │  │Dashboard │  │Dashboard │  ...          │ │
│  │  │ Pod 1    │  │ Pod 2    │  │ Pod N    │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘              │ │
│  │         │              │              │                  │ │
│  │         └──────────────┴──────────────┘                  │ │
│  │                        │                                  │ │
│  │                        ▼                                  │ │
│  │              ┌──────────────────┐                        │ │
│  │              │ Ingress (LB)     │                        │ │
│  │              └──────────────────┘                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Backend API Pods (Mostly Stateless - Scales with Caveats)│ │
│  │                                                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │Backend   │  │Backend   │  │Backend   │  ...          │ │
│  │  │ Pod 1    │  │ Pod 2    │  │ Pod N    │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘              │ │
│  │         │              │              │                  │ │
│  │         │              │              │                  │ │
│  │         │   Status Monitor runs in each pod              │ │
│  │         │   (needs leader election)                      │ │
│  │         │              │              │                  │ │
│  │         └──────────────┴──────────────┘                  │ │
│  │                        │                                  │ │
│  │                        ▼                                  │ │
│  │              ┌──────────────────┐                        │ │
│  │              │ Ingress (LB)     │                        │ │
│  │              └──────────────────┘                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Per-Store Components                                      │ │
│  │                                                           │ │
│  │  Medusa API (Stateless - Scales Horizontally)            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │Medusa API│  │Medusa API│  │Medusa API│  ...          │ │
│  │  │ Pod 1    │  │ Pod 2    │  │ Pod N    │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘              │ │
│  │         │              │              │                  │ │
│  │         └──────────────┴──────────────┘                  │ │
│  │                        │                                  │ │
│  │                        ▼                                  │ │
│  │              ┌──────────────────┐                        │ │
│  │              │ Service (LB)     │                        │ │
│  │              └──────────────────┘                        │ │
│  │                                                           │ │
│  │  Storefront (Stateless - Scales Horizontally)            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │Storefront│  │Storefront│  │Storefront│  ...          │ │
│  │  │ Pod 1    │  │ Pod 2    │  │ Pod N    │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘              │ │
│  │         │              │              │                  │ │
│  │         └──────────────┴──────────────┘                  │ │
│  │                        │                                  │ │
│  │                        ▼                                  │ │
│  │              ┌──────────────────┐                        │ │
│  │              │ Service (LB)     │                        │ │
│  │              └──────────────────┘                        │ │
│  │                                                           │ │
│  │  Postgres (Stateful - DOES NOT Scale Horizontally)       │ │
│  │  ┌──────────┐                                            │ │
│  │  │Postgres  │  Single replica per store                 │ │
│  │  │ Pod      │  Bound to PVC                              │ │
│  │  └────┬─────┘                                            │ │
│  │       │                                                   │ │
│  │       ▼                                                   │ │
│  │  ┌──────────┐                                            │ │
│  │  │   PVC    │  ReadWriteOnce (single node)              │ │
│  │  └──────────┘                                            │ │
│  │                                                           │ │
│  │  Solution: Use managed DB (RDS, Cloud SQL) for HA        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Local vs Production Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL DEPLOYMENT                             │
│                                                                 │
│  Domain: localtest.me (auto-resolves to 127.0.0.1)             │
│  Cluster: Kind/k3d/Minikube                                     │
│  Images: Built locally, loaded into cluster                     │
│  Storage: hostPath or default StorageClass                      │
│  Ingress: HTTP only (no TLS)                                    │
│  Secrets: Generated in-cluster                                  │
│  Resources: No limits (MVP)                                     │
│  Monitoring: None                                               │
│                                                                 │
│  Deployment:                                                    │
│    1. kind create cluster                                       │
│    2. kubectl apply -f ingress-nginx.yaml                       │
│    3. docker build -t myuser/backend:0.1.0 ./backend            │
│    4. kind load docker-image myuser/backend:0.1.0               │
│    5. helm install urumi-platform ./helm/store-platform \       │
│         -f values-local.yaml                                    │
│                                                                 │
│  Access: http://dashboard.localtest.me                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  PRODUCTION DEPLOYMENT (VPS)                    │
│                                                                 │
│  Domain: stores.example.com (DNS A records to VPS IP)           │
│  Cluster: k3s on VPS                                            │
│  Images: Pushed to Docker Hub, pulled from registry             │
│  Storage: local-path (k3s) or cloud provider                    │
│  Ingress: HTTPS with cert-manager + Let's Encrypt              │
│  Secrets: External secret manager (recommended)                 │
│  Resources: Requests/limits set                                 │
│  Monitoring: Prometheus + Grafana                               │
│                                                                 │
│  Deployment:                                                    │
│    1. curl -sfL https://get.k3s.io | sh -                       │
│    2. Configure DNS (*.stores.example.com → VPS_IP)             │
│    3. docker build -t myuser/backend:0.1.0 ./backend            │
│    4. docker push myuser/backend:0.1.0                          │
│    5. helm install urumi-platform ./helm/store-platform \       │
│         -f values-prod.yaml                                     │
│                                                                 │
│  Access: https://dashboard.stores.example.com                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Place Order

```
┌──────┐     ┌────────────┐     ┌──────────┐     ┌──────────┐
│ User │     │ Storefront │     │Medusa API│     │ Postgres │
└──┬───┘     └─────┬──────┘     └────┬─────┘     └────┬─────┘
   │               │                  │                │
   │ Browse store  │                  │                │
   │──────────────►│                  │                │
   │               │                  │                │
   │ Add to cart   │                  │                │
   │──────────────►│                  │                │
   │               │                  │                │
   │ Checkout      │                  │                │
   │──────────────►│                  │                │
   │               │                  │                │
   │               │ POST /cart       │                │
   │               │─────────────────►│                │
   │               │                  │                │
   │               │                  │ INSERT cart    │
   │               │                  │───────────────►│
   │               │                  │                │
   │               │                  │ cart_id        │
   │               │                  │◄───────────────│
   │               │                  │                │
   │               │ cart_id          │                │
   │               │◄─────────────────│                │
   │               │                  │                │
   │ Fill shipping │                  │                │
   │──────────────►│                  │                │
   │               │                  │                │
   │               │ POST /shipping   │                │
   │               │─────────────────►│                │
   │               │                  │                │
   │               │                  │ UPDATE cart    │
   │               │                  │───────────────►│
   │               │                  │                │
   │ Payment       │                  │                │
   │ (4242...)     │                  │                │
   │──────────────►│                  │                │
   │               │                  │                │
   │               │ POST /complete   │                │
   │               │─────────────────►│                │
   │               │                  │                │
   │               │                  │ INSERT order   │
   │               │                  │───────────────►│
   │               │                  │                │
   │               │                  │ order_id       │
   │               │                  │◄───────────────│
   │               │                  │                │
   │               │ order_id         │                │
   │               │◄─────────────────│                │
   │               │                  │                │
   │ Confirmation  │                  │                │
   │◄──────────────│                  │                │
   │               │                  │                │
```

Use these diagrams in your demo video, documentation, or presentations!
