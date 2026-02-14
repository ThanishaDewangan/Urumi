import React, { useEffect, useState } from "react";
import axios from "axios";

type StoreEngine = "medusa" | "woocommerce";
type StoreStatus = "provisioning" | "ready" | "failed" | "deleting";

interface Store {
  id: string;
  name: string;
  engine: StoreEngine;
  status: StoreStatus;
  createdAt: string;
  storefrontUrl?: string;
  adminUrl?: string;
  apiUrl?: string;
  reason?: string;
}

interface AuditEvent {
  timestamp: string;
  action: "store.created" | "store.deleted" | "store.provisioning.failed";
  storeId?: string;
  storeName?: string;
  engine?: string;
  reason?: string;
  ip?: string;
}

interface CustomDomain {
  storeId: string;
  domain: string;
  cnameTarget: string;
  status: "pending" | "verified" | "error";
  createdAt: string;
}

const api = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000"
});

export const App: React.FC = () => {
  const [stores, setStores] = useState<Store[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<StoreEngine>("medusa");
  const [loading, setLoading] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  
  // Custom domain state
  const [showDomainPanel, setShowDomainPanel] = useState(false);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [customDomain, setCustomDomain] = useState<CustomDomain | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainLoading, setDomainLoading] = useState(false);

  async function fetchStores() {
    const res = await api.get<Store[]>("/stores");
    setStores(res.data);
  }

  async function fetchAuditLog() {
    try {
      const res = await api.get<AuditEvent[]>("/stores/audit?limit=20");
      setAuditLog(res.data);
    } catch (err) {
      console.error("Failed to fetch audit log:", err);
    }
  }
  
  async function fetchCustomDomain(storeId: string) {
    try {
      const res = await api.get<CustomDomain>(`/domains/${storeId}`);
      setCustomDomain(res.data);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error("Failed to fetch custom domain:", err);
      }
      setCustomDomain(null);
    }
  }

  useEffect(() => {
    fetchStores();
    fetchAuditLog();
    const id = setInterval(() => {
      fetchStores();
      fetchAuditLog();
    }, 5000);
    return () => clearInterval(id);
  }, []);
  
  useEffect(() => {
    if (selectedStore) {
      fetchCustomDomain(selectedStore.id);
    }
  }, [selectedStore]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/stores", { name, engine });
      setName("");
      setEngine("medusa");
      await fetchStores();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setLoading(true);
    try {
      await api.delete(`/stores/${id}`);
      await fetchStores();
    } finally {
      setLoading(false);
    }
  }
  
  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStore || !domainInput) return;
    
    setDomainLoading(true);
    try {
      const res = await api.post<CustomDomain>("/domains", {
        storeId: selectedStore.id,
        domain: domainInput
      });
      setCustomDomain(res.data);
      setDomainInput("");
    } catch (err) {
      console.error("Failed to add domain:", err);
      alert("Failed to add custom domain");
    } finally {
      setDomainLoading(false);
    }
  }
  
  async function handleRemoveDomain() {
    if (!selectedStore) return;
    
    setDomainLoading(true);
    try {
      await api.delete(`/domains/${selectedStore.id}`);
      setCustomDomain(null);
    } catch (err) {
      console.error("Failed to remove domain:", err);
    } finally {
      setDomainLoading(false);
    }
  }

  function openDomainPanel(store: Store) {
    setSelectedStore(store);
    setShowDomainPanel(true);
    fetchCustomDomain(store.id);
  }

  function getActionLabel(action: string): string {
    switch (action) {
      case "store.created":
        return "Store Created";
      case "store.deleted":
        return "Store Deleted";
      case "store.provisioning.failed":
        return "Provisioning Failed";
      default:
        return action;
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Store Provisioning Dashboard</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setShowActivityLog(!showActivityLog)}>
            {showActivityLog ? "Hide" : "Show"} Activity Log
          </button>
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem" }}>
        <input
          placeholder="Store name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={engine} onChange={(e) => setEngine(e.target.value as StoreEngine)}>
          <option value="medusa">Medusa</option>
          <option value="woocommerce">WooCommerce (stub)</option>
        </select>
        <button type="submit" disabled={creating}>
          {creating ? "Creating..." : "Create Store"}
        </button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Engine</th>
            <th align="left">Status</th>
            <th align="left">Created</th>
            <th align="left">Links</th>
            <th align="left">Domain</th>
            <th align="left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.engine}</td>
              <td>
                <span style={{ 
                  color: s.status === "ready" ? "green" : s.status === "failed" ? "red" : "orange"
                }}>
                  {s.status}
                </span>
              </td>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td>
                {s.storefrontUrl && (
                  <a href={s.storefrontUrl} target="_blank" rel="noreferrer">
                    Storefront
                  </a>
                )}
              </td>
              <td>
                <button 
                  onClick={() => openDomainPanel(s)}
                  style={{ fontSize: "0.85em" }}
                >
                  {s.status === "ready" ? "Link Domain" : "N/A"}
                </button>
              </td>
              <td>
                <button onClick={() => handleDelete(s.id)} disabled={loading}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {stores.length === 0 && (
            <tr>
              <td colSpan={7}>No stores yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Custom Domain Panel */}
      {showDomainPanel && selectedStore && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <div style={{
            backgroundColor: "white",
            padding: "2rem",
            borderRadius: "8px",
            maxWidth: "500px",
            width: "100%"
          }}>
            <h2 style={{ marginTop: 0 }}>Custom Domain - {selectedStore.name}</h2>
            
            {customDomain ? (
              <div>
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Domain:</strong> {customDomain.domain}
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Status:</strong>{" "}
                  <span style={{ 
                    color: customDomain.status === "verified" ? "green" : 
                           customDomain.status === "pending" ? "orange" : "red"
                  }}>
                    {customDomain.status}
                  </span>
                </div>
                {customDomain.status === "pending" && (
                  <div style={{ marginBottom: "1rem", padding: "1rem", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
                    <strong>DNS Setup:</strong>
                    <p style={{ margin: "0.5rem 0", fontSize: "0.9em" }}>
                      Create a CNAME record for <code>{customDomain.domain}</code> pointing to:
                    </p>
                    <code style={{ display: "block", backgroundColor: "#eee", padding: "0.5rem", borderRadius: "4px" }}>
                      {customDomain.cnameTarget}
                    </code>
                  </div>
                )}
                <button 
                  onClick={handleRemoveDomain}
                  disabled={domainLoading}
                  style={{ backgroundColor: "#d32f2f", color: "white" }}
                >
                  {domainLoading ? "Removing..." : "Remove Domain"}
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddDomain}>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>
                    Enter your custom domain:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., mystore.com"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
                  />
                  <p style={{ fontSize: "0.85em", color: "#666", marginTop: "0.5rem" }}>
                    Enter your domain without http:// or https://
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit" disabled={domainLoading || !domainInput}>
                    {domainLoading ? "Adding..." : "Add Domain"}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setShowDomainPanel(false)}
                    style={{ backgroundColor: "#666" }}
                  >
                    Close
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showActivityLog && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Activity Log</h2>
          <div style={{ border: "1px solid #ddd", borderRadius: "4px", padding: "1rem", maxHeight: "400px", overflowY: "auto" }}>
            {auditLog.length === 0 ? (
              <p>No activity yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9em" }}>
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Action</th>
                    <th align="left">Store</th>
                    <th align="left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((event, idx) => (
                    <tr key={idx} style={{ borderTop: "1px solid #eee" }}>
                      <td>{new Date(event.timestamp).toLocaleString()}</td>
                      <td>{getActionLabel(event.action)}</td>
                      <td>
                        {event.storeName || event.storeId || "N/A"}
                        {event.engine && ` (${event.engine})`}
                      </td>
                      <td>
                        {event.reason && (
                          <span style={{ color: "#d32f2f" }}>{event.reason}</span>
                        )}
                        {!event.reason && event.storeId && (
                          <span style={{ color: "#666", fontSize: "0.85em" }}>ID: {event.storeId}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
