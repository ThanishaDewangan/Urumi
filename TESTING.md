# Testing Guide

This guide covers end-to-end testing for the Store Platform, including verification steps and troubleshooting.

## Quick Test

```bash
# 1. Create a store via dashboard
# 2. Wait for status to show "ready"
# 3. Click "Storefront" link
# 4. Add a product to cart
# 5. Checkout with test card: 4242 4242 4242 4242
# 6. Verify order via API:
curl http://api-{store-id}.localtest.me/store/orders
```

## End-to-End Order Placement Walkthrough

### Step 1: Create a Store

1. Open the dashboard: http://dashboard.localtest.me
2. Enter a store name (e.g., "Test Store")
3. Select "Medusa" as the engine
4. Click "Create Store"
5. Wait for status to change from "provisioning" to "ready" (~30-60 seconds)

### Step 2: Access the Storefront

1. Once status is "ready", click the "Storefront" link
2. The storefront should load at: `http://store-{id}.localtest.me`
3. Browse the default products

### Step 3: Add Product to Cart

1. Click on a product
2. Select variant/options if applicable
3. Click "Add to Cart"
4. Verify cart shows the product

### Step 4: Checkout

1. Click "Checkout" or the cart icon
2. Enter test customer details:
   - Email: test@example.com
   - First Name: Test
   - Last Name: User
   - Address: 123 Test St
   - City: Test City
   - Country: US
   - Postal Code: 12345
3. Enter test payment card:
   - Card Number: 4242 4242 4242 4242
   - Expiry: 12/25
   - CVC: 123
4. Click "Complete Order"

### Step 5: Verify Order

```bash
# Get the store ID from the dashboard
# API endpoint for orders
curl http://api-{store-id}.localtest.me/store/orders
```

Or check via Medusa admin:

1. Navigate to: `http://api-{store-id}.localtest.me/admin`
2. Login with default admin credentials (if configured)
3. Check Orders section

## Verification Steps for Definition of Done

### Infrastructure

- [ ] Kubernetes cluster is running
- [ ] Ingress controller is working
- [ ] Backend API is accessible
- [ ] Dashboard is accessible

### Store Provisioning

- [ ] Store creates successfully
- [ ] Status changes from "provisioning" → "ready"
- [ ] All pods are running (postgres, medusa-api, medusa-storefront)
- [ ] Store can be deleted

### Storefront Functionality

- [ ] Storefront loads
- [ ] Products are displayed
- [ ] Cart works
- [ ] Checkout flow completes

### Multi-tenancy

- [ ] Each store is in its own namespace
- [ ] Stores cannot access each other's resources
- [ ] Resource quotas are enforced

### Security

- [ ] Non-root containers
- [ ] Network policies applied
- [ ] RBAC configured

### Observability

- [ ] Activity log shows store created/deleted
- [ ] Metrics endpoint works
- [ ] Failure reasons are displayed

## Troubleshooting Common Issues

### Store Stuck in "provisioning"

```bash
# Check pod status
kubectl get pods -n store-{id}

# Check pod events
kubectl describe pod -n store-{id}

# Check pod logs
kubectl logs -n store-{id} deployment/medusa-api
kubectl logs -n store-{id} deployment/medusa-storefront
```

### ImagePullBackOff

```bash
# Check if image exists
docker images | grep medusa

# For kind, load image
kind load docker-image medusajs/medusa:latest
```

### Ingress Not Working

```bash
# Check ingress
kubectl get ingress -n store-{id}

# Check ingress controller
kubectl get pods -n ingress-nginx

# Check DNS
nslookup store-{id}.localtest.me
```

### Database Connection Issues

```bash
# Check postgres
kubectl exec -n store-{id} postgres-0 -- pg_isready

# Check DATABASE_URL in secret
kubectl get secret -n store-{id} postgres-credentials -o yaml
```

### Port Forward for Testing

```bash
# Forward store API
kubectl port-forward -n store-{id} svc/medusa-api 9000:80

# Test API
curl http://localhost:9000/health
```

## Performance Testing

### Load Testing

```bash
# Install hey (HTTP load tester)
go install github.com/rakyll/hey@latest

# Test storefront
hey -n 1000 -c 10 http://store-{id}.localtest.me

# Test API
hey -n 1000 -c 5 http://api-{id}.localtest.me/store/products
```

### Resource Usage

```bash
# Check resource usage
kubectl top pods -n store-{id}

# Check resource quotas
kubectl get resourcequota -n store-{id}
```

## Security Testing

### Container Security

```bash
# Check if containers run as non-root
kubectl get pods -n store-{id} -o jsonpath='{.items[*].spec.securityContext}'

# Check network policies
kubectl get networkpolicy -n store-{id}
```

### RBAC Testing

```bash
# Check service account permissions
kubectl auth can-i --list --as=system:serviceaccount:urumi-platform:backend
```

## Automated Tests

### API Tests

```bash
# Test store creation
curl -X POST http://localhost:4000/stores \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Store", "engine": "medusa"}'

# Test store deletion
curl -X DELETE http://localhost:4000/stores/{id}

# Test metrics
curl http://localhost:4000/metrics
```

### Integration Test Script

```bash
#!/bin/bash
# test-store.sh

# Create store
STORE=$(curl -s -X POST http://localhost:4000/stores \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Store", "engine": "medusa"}')

STORE_ID=$(echo $STORE | jq -r '.id')
echo "Created store: $STORE_ID"

# Wait for ready
echo "Waiting for store to be ready..."
for i in {1..30}; do
  STATUS=$(curl -s http://localhost:4000/stores | jq -r '.[] | select(.id=="'$STORE_ID'") | .status')
  if [ "$STATUS" == "ready" ]; then
    echo "Store is ready!"
    break
  fi
  sleep 2
done

# Delete store
curl -X DELETE http://localhost:4000/stores/$STORE_ID
echo "Store deleted"
```
