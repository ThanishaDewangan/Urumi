import { Router } from "express";
import { getK8sClients } from "../k8s/client";
import { config } from "../config";

export const domainsRouter = Router();

// Store custom domain configuration
// WARNING: This uses in-memory storage and will be lost on pod restart.
// For production, use a persistent database (PostgreSQL, Redis, etc.)
interface CustomDomain {
  storeId: string;
  domain: string;
  cnameTarget: string;
  status: "pending" | "verified" | "error";
  createdAt: string;
}

// In-memory store for custom domains (use database in production)
const customDomains = new Map<string, CustomDomain>();

// GET /domains - List all custom domains
domainsRouter.get("/", async (_req, res, next) => {
  try {
    const domains = Array.from(customDomains.values());
    res.json(domains);
  } catch (err) {
    next(err);
  }
});

// GET /domains/:storeId - Get custom domain for a store
domainsRouter.get("/:storeId", async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const domain = customDomains.get(storeId);
    
    if (!domain) {
      return res.status(404).json({ error: "Custom domain not configured for this store" });
    }
    
    res.json(domain);
  } catch (err) {
    next(err);
  }
});

// POST /domains/:storeId - Configure custom domain for a store
domainsRouter.post("/", async (req, res, next) => {
  try {
    const { storeId, domain } = req.body as { storeId: string; domain: string };
    
    if (!storeId || !domain) {
      return res.status(400).json({ error: "storeId and domain are required" });
    }
    
    // Validate domain format
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({ error: "Invalid domain format" });
    }
    
    // Verify store exists
    const { core, networking } = getK8sClients();
    const nsName = `${config.storeNamespacePrefix}${storeId}`;
    
    try {
      await core.readNamespace(nsName);
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        return res.status(404).json({ error: "Store not found" });
      }
      throw err;
    }
    
    // Generate CNAME target (the platform domain)
    const cnameTarget = `store-${storeId}.${config.baseDomain}`;
    
    // Update Ingress with custom domain
    const ingressName = "medusa-storefront-custom";
    try {
      await networking.readNamespacedIngress(ingressName, nsName);
      
      // Update existing ingress
      await networking.patchNamespacedIngress(ingressName, nsName, {
        spec: {
          rules: [
            {
              host: domain,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: {
                        name: "medusa-storefront",
                        port: { number: 80 }
                      }
                    }
                  }
                ]
              }
            }
          ],
          tls: [
            {
              hosts: [domain],
              secretName: `tls-${domain.replace(/\./g, "-")}`
            }
          ]
        }
      });
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        // Create new ingress for custom domain
        await networking.createNamespacedIngress(nsName, {
          apiVersion: "networking.k8s.io/v1",
          kind: "Ingress",
          metadata: {
            name: ingressName,
            annotations: {
              "kubernetes.io/ingress.class": "nginx",
              "cert-manager.io/cluster-issuer": "letsencrypt-prod"
            }
          },
          spec: {
            rules: [
              {
                host: domain,
                http: {
                  paths: [
                    {
                      path: "/",
                      pathType: "Prefix",
                      backend: {
                        service: {
                          name: "medusa-storefront",
                          port: { number: 80 }
                        }
                      }
                    }
                  ]
                }
              }
            ],
            tls: [
              {
                hosts: [domain],
                secretName: `tls-${domain.replace(/\./g, "-")}`
              }
            ]
          }
        });
      } else {
        throw err;
      }
    }
    
    // Store custom domain configuration
    const customDomain: CustomDomain = {
      storeId,
      domain,
      cnameTarget,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    
    customDomains.set(storeId, customDomain);
    
    // Simulate verification (in production, check DNS)
    setTimeout(() => {
      const d = customDomains.get(storeId);
      if (d) {
        d.status = "verified";
        customDomains.set(storeId, d);
      }
    }, 5000);
    
    res.status(201).json(customDomain);
  } catch (err) {
    next(err);
  }
});

// DELETE /domains/:storeId - Remove custom domain
domainsRouter.delete("/:storeId", async (req, res, next) => {
  try {
    const { storeId } = req.params;
    
    const domain = customDomains.get(storeId);
    if (!domain) {
      return res.status(404).json({ error: "Custom domain not configured" });
    }
    
    // Delete the custom domain ingress
    const { networking } = getK8sClients();
    const nsName = `${config.storeNamespacePrefix}${storeId}`;
    
    try {
      await networking.deleteNamespacedIngress("medusa-storefront-custom", nsName);
    } catch (err: any) {
      // Ignore if doesn't exist
      if (err.response?.statusCode !== 404) {
        throw err;
      }
    }
    
    customDomains.delete(storeId);
    
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /domains/:storeId/verification - Get DNS verification info
domainsRouter.get("/:storeId/verification", async (req, res, next) => {
  try {
    const { storeId } = req.params;
    
    const domain = customDomains.get(storeId);
    if (!domain) {
      return res.status(404).json({ error: "Custom domain not configured" });
    }
    
    res.json({
      domain: domain.domain,
      cnameTarget: domain.cnameTarget,
      recordType: "CNAME",
      instructions: `Create a CNAME record for ${domain.domain} pointing to ${domain.cnameTarget}`
    });
  } catch (err) {
    next(err);
  }
});
