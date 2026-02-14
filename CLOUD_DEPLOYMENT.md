# Cloud Deployment Guide

Deploy the Store Platform on AWS or Google Cloud using their free tier options.

## Table of Contents
- [AWS Free Tier Deployment](#aws-free-tier-deployment)
- [Google Cloud Free Tier Deployment](#google-cloud-free-tier-deployment)
- [DNS Configuration](#dns-configuration)
- [TLS/SSL Setup](#tlsssl-setup)

---

## AWS Free Tier Deployment

### Prerequisites
- AWS Account (free tier eligible)
- Domain name (optional, can use AWS-provided URL)

### Option 1: EKS Auto Mode (Easiest)

EKS Auto Mode includes some free tier benefits:

```bash
# Install AWS CLI and eksctl
brew install awscli eksctl kubectl

# Create EKS cluster (note: not free tier eligible, see Option 2)
eksctl create cluster \
  --name urumi-platform \
  --region us-west-2 \
  --nodes 2
```

**Note**: EKS is NOT free tier eligible. Use EKS Anywhere or self-managed k3s instead.

### Option 2: EC2 with k3s (Free Tier Eligible)

This runs on t3.micro (750 hours/month free):

```bash
# 1. Launch EC2 Instance (t3.micro)
# - Ubuntu 22.04 LTS
# - Security Group: Open ports 80, 443, 6443

# 2. SSH into instance and install k3s
curl -sfL https://get.k3s.io | sh -

# 3. Get kubectl config
sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/config
chmod 600 ~/.kube/config

# 4. Install Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.4/deploy/static/provider/cloud/deploy.yaml

# 5. Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# 6. Deploy the platform
helm install urumi-platform ./helm/store-platform -n urumi-platform --create-namespace -f values-prod.yaml
```

### Option 3: EKS Anywhere (Free for Personal Use)

EKS Anywhere lets you run Kubernetes on your own infrastructure:

```bash
# Download EKS Anywhere
brew install aws/tap/eks-anywhere

# Create cluster (on-premises or EC2)
eksctl anywhere create cluster \
  --provider vsphere \
  --cluster-name urumi-platform
```

---

## Google Cloud Free Tier Deployment

### Prerequisites
- Google Cloud Account
- Billing enabled (required for GKE)

### Option 1: GKE Autopilot (Free Tier Eligible)

GKE Autopilot has free tier for 3 clusters:

```bash
# Install gcloud and kubectl
gcloud components install kubectl

# Set project
gcloud config set project YOUR_PROJECT_ID

# Enable GKE API
gcloud services enable container.googleapis.com

# Create Autopilot cluster (pay-per-node or Autopilot mode)
gcloud container clusters create urumi-platform \
  --region us-central1 \
  --enable-autopilot

# Get credentials
gcloud container clusters get-credentials urumi-platform --region us-central1

# Deploy platform
helm install urumi-platform ./helm/store-platform -n urumi-platform --create-namespace -f values-prod.yaml
```

### Option 2: GKE Standard (Free Tier Eligible)

```bash
# Create zonal cluster (uses free tier nodes)
gcloud container clusters create urumi-platform \
  --zone us-central1-a \
  --num-nodes=1 \
  --machine-type=e2-micro

# Note: e2-micro gives ~600MiB memory, may need larger for production
```

### Option 3: Google Compute Engine (Free Tier Eligible)

Run k3s on a GCE f1-micro (750 hours/month free):

```bash
# 1. Create VM instance (f1-micro)
gcloud compute instances create urumi-vm \
  --zone=us-central1-a \
  --machine-type=f1-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud

# 2. SSH into instance
gcloud compute ssh urumi-vm --zone=us-central1-a

# 3. Install k3s
curl -sfL https://get.k3s.io | K3S_TOKEN=your-token sh -

# 4. Configure firewall (allow HTTP, HTTPS, port 6443)
gcloud compute firewall-rules create allow-http-https \
  --allow tcp:80,tcp:443,tcp:6443 \
  --source-ranges 0.0.0.0/0

# 5. Install ingress and cert-manager
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.4/deploy/static/provider/cloud/deploy.yaml
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# 6. Deploy platform
kubectl create namespace urumi-platform
helm install urumi-platform ./helm/store-platform -n urumi-platform -f values-prod.yaml
```

---

## DNS Configuration

### Using External-DNS (Automatic)

Install external-dns to automatically manage DNS records:

```yaml
# external-dns.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: external-dns
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: external-dns
rules:
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: external-dns
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: external-dns
subjects:
  - kind: ServiceAccount
    name: external-dns
    namespace: default
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
spec:
  selector:
    matchLabels:
      app: external-dns
  template:
    spec:
      serviceAccountName: external-dns
      containers:
        - name: external-dns
          image: registry.k8s.io/external-dns/external-dns:v0.14.0
          args:
            - --source=ingress
            # For AWS Route53:
            # - --provider=aws
            # For Google Cloud DNS:
            # - --provider=google
            # - --google-project=YOUR_PROJECT_ID
            # For CloudFlare:
            # - --provider=cloudflare
            # - --cloudflare-proxied
          env:
            - name: AWS_ACCESS_KEY_ID
              value: "YOUR_ACCESS_KEY"
            - name: AWS_SECRET_ACCESS_KEY
              value: "YOUR_SECRET_KEY"
```

### Manual DNS Setup

If not using external-dns, manually configure:

```
# In your domain registrar or DNS provider:

# A Record - Dashboard
dashboard.stores.yourdomain.com -> YOUR_VM_IP

# A Record - API  
api.stores.yourdomain.com -> YOUR_VM_IP

# CNAME Records - Stores (wildcard)
*.stores.yourdomain.com -> your-vm.example.com
```

### For Cloud Load Balancers

```yaml
# values-prod.yaml
dashboard:
  service:
    type: LoadBalancer  # GCP/AWS will provision cloud load balancer

backend:
  service:
    type: LoadBalancer

ingress:
  # For GCP, use:
  className: nginx
  annotations:
    kubernetes.io/ingress.class: nginx
    # GCP specific
    kubernetes.io/ingress.global-static-ip-name: your-ip-name
```

---

## TLS/SSL Setup

### Using Let's Encrypt (Automatic)

```yaml
# values-prod.yaml
global:
  baseDomain: stores.yourdomain.com

dashboard:
  ingress:
    enabled: true
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
      nginx.ingress.kubernetes.io/ssl-redirect: "true"
    tls:
      - secretName: dashboard-tls
        hosts:
          - dashboard.stores.yourdomain.com

backend:
  ingress:
    enabled: true
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    tls:
      - secretName: api-tls
        hosts:
          - api.stores.yourdomain.com

# Create ClusterIssuer
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### Using Cloud-Provided Certificates

#### AWS Certificate Manager

```yaml
# values-prod.yaml
dashboard:
  ingress:
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-ssl-cert: arn:aws:acm:us-east-1:123456789:certificate/abc-123
```

#### Google Cloud SSL Certificates

```yaml
# values-prod.yaml
dashboard:
  ingress:
    annotations:
      kubernetes.io/ingress.gcp-global-static-ip-name: your-ip-name
      networking.gke.io/static-ip-name: your-ip-name
```

---

## Free Tier Resource Limits

| Cloud | Free Tier Limits | Notes |
|-------|-----------------|-------|
| AWS EC2 | 750 hrs/month (t3.micro) | 1 vCPU, 1 GiB RAM |
| AWS EKS | Not free | Use self-managed k3s |
| GCE | 750 hrs/month (f1-micro) | 1 vCPU, 0.6 GiB RAM |
| GKE | 3 clusters free | Autopilot or Standard |
| Cloud DNS | 1 zone free | 1M queries/month |
| Route 53 | $0.50/month per zone | First 25 zones |
| Let's Encrypt | Free | Rate limits apply |

---

## Cost Optimization Tips

1. **Use spot/preemptible instances** for non-critical workloads
2. **Set up resource limits** to prevent runaway usage
3. **Use monitoring** to track usage
4. **Delete unused resources** promptly
5. **Consider managed databases** for production (not free tier)

```yaml
# values-prod.yaml - Conservative resource settings
backend:
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

dashboard:
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 250m
      memory: 256Mi
```
