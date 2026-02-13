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

  useEffect(() => {
    fetchStores();
    fetchAuditLog();
    const id = setInterval(() => {
      fetchStores();
      fetchAuditLog();
    }, 5000);
    return () => clearInterval(id);
  }, []);

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
        <button onClick={() => setShowActivityLog(!showActivityLog)}>
          {showActivityLog ? "Hide" : "Show"} Activity Log
        </button>
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
            <th align="left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.engine}</td>
              <td>{s.status}</td>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td>
                {s.storefrontUrl && (
                  <a href={s.storefrontUrl} target="_blank" rel="noreferrer">
                    Storefront
                  </a>
                )}
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
              <td colSpan={6}>No stores yet.</td>
            </tr>
          )}
        </tbody>
      </table>

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

