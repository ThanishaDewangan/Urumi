interface AuditEvent {
  timestamp: string;
  action: "store.created" | "store.deleted" | "store.provisioning.failed";
  storeId?: string;
  storeName?: string;
  engine?: string;
  reason?: string;
  ip?: string;
}

const auditLog: AuditEvent[] = [];
const MAX_AUDIT_LOG_SIZE = 1000; // Keep last 1000 events

export function logAuditEvent(event: Omit<AuditEvent, "timestamp">): void {
  const auditEvent: AuditEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };
  
  auditLog.push(auditEvent);
  
  // Keep only last MAX_AUDIT_LOG_SIZE events
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.shift();
  }
  
  // Also log to console for now (in production, send to centralized logging)
  console.log(`[AUDIT] ${auditEvent.timestamp} ${auditEvent.action}`, {
    storeId: auditEvent.storeId,
    storeName: auditEvent.storeName,
    engine: auditEvent.engine,
    reason: auditEvent.reason,
    ip: auditEvent.ip
  });
}

export function getAuditLog(limit: number = 100): AuditEvent[] {
  return auditLog.slice(-limit).reverse(); // Most recent first
}

export function getAuditLogForStore(storeId: string): AuditEvent[] {
  return auditLog.filter(e => e.storeId === storeId).reverse();
}
