# Urumi Store Provisioning Platform (Round 1)

## Overview
This repository implements the Round 1 **"Store Orchestration (Local-to-Prod)"** task from the Urumi AI SDE Internship assignment.

It provides:
- A **React** dashboard to manage stores.
- A **Node.js + TypeScript** backend API and orchestrator that provisions stores on Kubernetes.
- **Helm** charts for local Kubernetes and VPS (k3s) deployments using the same chart with different values.

## Components
- **Dashboard**: React + TypeScript single-page app for:
  - Viewing existing stores and their status.
  - Creating new stores (Medusa fully implemented, WooCommerce stubbed initially).
  - Deleting stores and viewing URLs.
- **Backend API & Orchestrator**: Node.js + TypeScript + Express service responsible for:
  - Managing store records and status.
  - Talking to the Kubernetes API to create/delete store resources.
  - Ensuring idempotent provisioning and safe cleanup.
- **Kubernetes & Helm**:
  - Namespace-per-store isolation.
  - Deployments/StatefulSets, Services, Ingress, PVCs, Secrets.
  - A single Helm chart (`helm/store-platform`) with environment-specific values files.

## Prerequisites

### For Local Development
- **Node.js** (LTS version, e.g., 20.x)
- **Docker** Desktop (or Docker Engine)
- **kubectl** (configured to access your cluster)
- **Helm** 3.x
- **Local Kubernetes cluster** (choose one):
  - **Kind**: `kind create cluster`
  - **Minikube**: `minikube start`
  - **k3d**: `k3d cluster create mycluster`

### For VPS/Production Deployment
- **VPS** with Ubuntu 20.04+ or similar Linux distribution
- **k3s** installed on VPS
- **Domain name** with DNS access (for production deployment)
- **Docker Hub** account (or another container registry)

## Local Setup Instructions

### Step 1: Start Local Kubernetes Cluster

**Using Kind:**
```bash
kind create cluster --name urumi-platform
kubectl cluster-info --context kind-urumi-platform
```

**Using Minikube:**
```bash
minikube start
minikube addons enable ingress
```

**Using k3d:**
```bash
k3d cluster create urumi-platform --port "80:80@loadbalancer" --port "443:443@loadbalancer"
```

### Step 2: Install Ingress Controller

**For Kind/Minikube:**
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
# Wait for ingress controller to be ready
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s
```

**For k3d:** Ingress controller (Traefik) is included by default.

### Step 3: Verify Storage Class

Check available storage classes:
```bash
kubectl get storageclass
```

If no `standard` storage class exists, create one (for Kind/Minikube):
```bash
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
EOF
```

### Step 4: Build Docker Images

**Build Backend Image:**
```bash
cd backend
docker build -t your-docker-username/store-platform-backend:0.1.0 .
cd ..
```

**Build Dashboard Image:**
```bash
cd dashboard
docker build -t your-docker-username/store-platform-dashboard:0.1.0 .
cd ..
```

### Step 5: Load Images into Cluster

**For Kind:**
```bash
kind load docker-image your-docker-username/store-platform-backend:0.1.0 --name urumi-platform
kind load docker-image your-docker-username/store-platform-dashboard:0.1.0 --name urumi-platform
```

**For Minikube:**
```bash
eval $(minikube docker-env)
docker build -t your-docker-username/store-platform-backend:0.1.0 ./backend
docker build -t your-docker-username/store-platform-dashboard:0.1.0 ./dashboard
eval $(minikube docker-env -u)
```

**For k3d:**
```bash
k3d image import your-docker-username/store-platform-backend:0.1.0 -c urumi-platform
k3d image import your-docker-username/store-platform-dashboard:0.1.0 -c urumi-platform
```

### Step 6: Update Helm Values

Edit `helm/store-platform/values-local.yaml` and replace `your-docker-username` with your actual Docker Hub username (or use local image names if not pushing to registry).

### Step 7: Install Helm Chart

```bash
helm install store-platform ./helm/store-platform -f helm/store-platform/values-local.yaml
```

### Step 8: Configure DNS

**Option 1: Use localtest.me** (auto-resolves to 127.0.0.1)
- No configuration needed, just use `http://dashboard.localtest.me` and `http://api.localtest.me`

**Option 2: Add to /etc/hosts** (Linux/Mac) or `C:\Windows\System32\drivers\etc\hosts` (Windows)
```
127.0.0.1 dashboard.localtest.me
127.0.0.1 api.localtest.me
```

**For Minikube:**
```bash
# Get Minikube IP
MINIKUBE_IP=$(minikube ip)
echo "$MINIKUBE_IP dashboard.localtest.me" | sudo tee -a /etc/hosts
echo "$MINIKUBE_IP api.localtest.me" | sudo tee -a /etc/hosts
```

### Step 9: Verify Installation

```bash
# Check pods are running
kubectl get pods

# Check services
kubectl get services

# Check ingress
kubectl get ingress

# Access dashboard
# Open browser: http://dashboard.localtest.me
```

## VPS / Production-like Setup Instructions (k3s)

### Step 1: Provision VPS and Install k3s

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Install k3s
curl -sfL https://get.k3s.io | sh -

# Verify installation
sudo k3s kubectl get nodes

# Get kubeconfig for local access
sudo cat /etc/rancher/k3s/k3s.yaml
```

### Step 2: Configure Local kubectl

Copy the k3s kubeconfig to your local machine:
```bash
# On VPS
sudo cat /etc/rancher/k3s/k3s.yaml

# On local machine, create/edit ~/.kube/config
# Replace server IP with your VPS IP
# Replace default context name if needed
```

### Step 3: Configure DNS

Point your domain to VPS IP:
- `dashboard.stores.example.com` → VPS IP
- `api.stores.example.com` → VPS IP
- `*.stores.example.com` → VPS IP (wildcard for store subdomains)

### Step 4: Build and Push Images to Docker Hub

```bash
# Login to Docker Hub
docker login

# Build and push backend
cd backend
docker build -t your-docker-username/store-platform-backend:0.1.0 .
docker push your-docker-username/store-platform-backend:0.1.0
cd ..

# Build and push dashboard
cd dashboard
docker build -t your-docker-username/store-platform-dashboard:0.1.0 .
docker push your-docker-username/store-platform-dashboard:0.1.0
cd ..
```

### Step 5: Update Production Values

Edit `helm/store-platform/values-prod.yaml`:
```yaml
global:
  baseDomain: stores.example.com  # Your actual domain
  storageClassName: local-path     # k3s default storage class

dashboard:
  image:
    repository: your-docker-username/store-platform-dashboard
    tag: "0.1.0"
  ingress:
    host: dashboard.stores.example.com

backend:
  image:
    repository: your-docker-username/store-platform-backend
    tag: "0.1.0"
  ingress:
    host: api.stores.example.com
```

### Step 6: Install Helm Chart on VPS

```bash
# Ensure Helm is installed on VPS
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install chart
helm install store-platform ./helm/store-platform -f helm/store-platform/values-prod.yaml

# Verify
kubectl get pods
kubectl get ingress
```

### Step 7: Access Dashboard

Open browser: `https://dashboard.stores.example.com` (or `http://` if TLS not configured)

## How to Create a Store and Place an Order

### Step 1: Access Dashboard

Open `http://dashboard.localtest.me` (local) or `https://dashboard.stores.example.com` (production)

### Step 2: Create a Store

1. Click **"Create Store"** button
2. Enter store name (e.g., "My Test Store")
3. Select engine: **"Medusa"**
4. Click **"Create Store"**

### Step 3: Wait for Provisioning

- Status will show **"provisioning"** initially
- Wait 2-5 minutes for all pods to start
- Status should change to **"ready"** when:
  - Postgres StatefulSet is ready
  - Medusa API deployment is ready
  - Medusa Storefront deployment is ready
  - Ingresses are configured

### Step 4: Access Storefront

1. Click the **"Storefront"** link for your store
2. URL format: `http://store-{id}.localtest.me` (local) or `https://store-{id}.stores.example.com` (production)

### Step 5: Place an Order

1. **Browse products** - Medusa starter comes with sample products
2. **Add product to cart** - Click "Add to Cart" on any product
3. **Go to checkout** - Click cart icon and proceed to checkout
4. **Fill shipping information**:
   - Name, email, address
5. **Payment** (if using test payment):
   - Use test card: `4242 4242 4242 4242`
   - Any future expiry date
   - Any CVC
6. **Complete order** - Click "Place Order"

### Step 6: Verify Order Creation

**Option 1: Via API**
```bash
# Get store ID from dashboard
STORE_ID="your-store-id"

# Query orders API
curl http://api-${STORE_ID}.localtest.me/store/orders
# or for production:
curl https://api-${STORE_ID}.stores.example.com/store/orders
```

**Option 2: Via Medusa Admin** (if admin UI is accessible)
- Access admin URL: `http://admin-${STORE_ID}.localtest.me`
- Login with default credentials (if configured)
- Navigate to Orders section

### Step 7: Delete Store

1. Return to dashboard
2. Click **"Delete"** button for the store
3. Wait for namespace deletion (30-60 seconds)
4. Verify cleanup:
   ```bash
   kubectl get namespace store-{id}  # Should return "not found"
   ```

## Troubleshooting

### Dashboard Not Accessible
```bash
# Check ingress status
kubectl get ingress

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller

# Verify DNS resolution
nslookup dashboard.localtest.me
```

### Store Stuck in "Provisioning"
```bash
# Check pods in store namespace
kubectl get pods -n store-{id}

# Check pod logs
kubectl logs -n store-{id} deployment/medusa-api
kubectl logs -n store-{id} statefulset/postgres

# Check events
kubectl get events -n store-{id} --sort-by='.lastTimestamp'
```

### Backend Cannot Create Resources
```bash
# Check backend logs
kubectl logs deployment/store-platform-backend

# Verify RBAC permissions
kubectl auth can-i create namespaces --as=system:serviceaccount:default:store-platform-backend-sa
```

### Images Not Found
```bash
# Verify images are loaded (for local clusters)
docker images | grep store-platform

# For Kind: reload images
kind load docker-image your-docker-username/store-platform-backend:0.1.0 --name urumi-platform

# Check image pull policy in values
```

## Deliverables (in this repo)

- **README.md** – Local setup instructions, VPS/production-like setup (k3s), and how to create a store and place an order (see sections above).
- **Source code** – Dashboard (`dashboard/`), backend API and provisioning/orchestration (`backend/`), including store lifecycle and K8s resource creation.
- **Helm** – Chart in `helm/store-platform/` with `values-local.yaml` (local) and `values-prod.yaml` (production).
- **System design & tradeoffs** – Short note in [SYSTEM_DESIGN_TRADEOFFS.md](SYSTEM_DESIGN_TRADEOFFS.md): architecture choice, idempotency/failure handling/cleanup, and what changes for production (DNS, ingress, storage class, secrets, etc.).

For the **demo video**, use the checklist in [DEMO_VIDEO_REQUIREMENTS.md](DEMO_VIDEO_REQUIREMENTS.md) so the video covers system design, components, end-to-end flow, isolation/resources/reliability, security, scaling, abuse prevention, and local-to-VPS story.

## System Design & Tradeoffs

See [SYSTEM_DESIGN_TRADEOFFS.md](SYSTEM_DESIGN_TRADEOFFS.md) for a short note on architecture, idempotency/failure/cleanup, and production differences. For more detail (if present), see [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md) and [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md):
- Architecture overview and component responsibilities
- End-to-end flow diagrams
- Isolation, resources, and reliability strategies
- Security posture (secrets, RBAC, container hardening)
- Horizontal scaling plan and stateful constraints
- Abuse prevention (rate limiting, quotas, audit trails)
- Local-to-VPS production story
- Idempotency and failure handling approach
- Cleanup guarantees
- Upgrade/rollback strategies with Helm
- Design tradeoffs and future enhancements

## Demo Video Guide

- **[DEMO_VIDEO_REQUIREMENTS.md](DEMO_VIDEO_REQUIREMENTS.md)** – Checklist for what the video must cover (system design, flow, isolation, security, scaling, abuse prevention, local-to-VPS, deliverables).
- **[DEMO_VIDEO_SCRIPT.md](DEMO_VIDEO_SCRIPT.md)** – Full script with talking points and [SHOW] cues for recording (~10–15 min).

## Project Structure

```
urumi/
├── backend/                 # Node.js + TypeScript backend API
│   ├── src/
│   │   ├── index.ts        # Express app entrypoint
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic (K8s provisioning)
│   │   ├── k8s/            # Kubernetes client setup
│   │   └── types/           # TypeScript types
│   ├── Dockerfile
│   └── package.json
├── dashboard/               # React + TypeScript frontend
│   ├── src/
│   │   ├── App.tsx         # Main component
│   │   └── main.tsx        # Entrypoint
│   ├── Dockerfile
│   └── package.json
├── helm/
│   └── store-platform/      # Helm chart
│       ├── Chart.yaml
│       ├── values.yaml      # Base values
│       ├── values-local.yaml # Local cluster values
│       ├── values-prod.yaml # Production values
│       └── templates/       # K8s manifests
├── README.md                     # This file
├── DEMO_VIDEO_REQUIREMENTS.md    # Demo video checklist
├── DEMO_VIDEO_SCRIPT.md          # Video script (talking points + cues)
└── SYSTEM_DESIGN_TRADEOFFS.md    # Architecture & tradeoffs note
```

## License

This project is part of the Urumi AI SDE Internship Round 1 assessment. All code is owned by the submitter.
