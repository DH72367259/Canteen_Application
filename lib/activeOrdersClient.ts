export type ActiveOrderLike = {
  id: string;
  uid?: string | null;
  slot?: string;
  status?: string;
  createdAt?: string;
};

const SINGLE_KEY = "canteen_active_order";
const LIST_KEY = "canteen_active_orders";
const MAX_ACTIVE_ORDERS = 25;

function isTerminal(status?: string | null): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "collected" || s === "completed" || s === "cancelled";
}

export function readActiveOrders(uid?: string | null): ActiveOrderLike[] {
  if (typeof window === "undefined") return [];

  const normalize = (rows: ActiveOrderLike[]) => {
    const filtered = rows.filter((o) => {
      if (!o?.id) return false;
      if (uid && o.uid && o.uid !== uid) return false;
      return !isTerminal(o.status);
    });
    const dedup = new Map<string, ActiveOrderLike>();
    for (const row of filtered) dedup.set(row.id, row);
    return Array.from(dedup.values()).slice(0, MAX_ACTIVE_ORDERS);
  };

  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed as ActiveOrderLike[]);
    }
  } catch {
    // Fall through to single-key compatibility path.
  }

  try {
    const rawSingle = localStorage.getItem(SINGLE_KEY);
    if (!rawSingle) return [];
    const parsed = JSON.parse(rawSingle) as ActiveOrderLike;
    return normalize([parsed]);
  } catch {
    return [];
  }
}

export function writeActiveOrders(rows: ActiveOrderLike[]): void {
  if (typeof window === "undefined") return;
  const safeRows = rows.filter((r) => r?.id && !isTerminal(r.status)).slice(0, MAX_ACTIVE_ORDERS);
  localStorage.setItem(LIST_KEY, JSON.stringify(safeRows));
  if (safeRows.length > 0) {
    localStorage.setItem(SINGLE_KEY, JSON.stringify(safeRows[0]));
  } else {
    localStorage.removeItem(SINGLE_KEY);
  }
}

export function upsertActiveOrder(row: ActiveOrderLike): ActiveOrderLike[] {
  const existing = readActiveOrders(row.uid);
  const next = [row, ...existing.filter((o) => o.id !== row.id && !isTerminal(o.status))].slice(0, MAX_ACTIVE_ORDERS);
  writeActiveOrders(next);
  return next;
}

export function removeActiveOrder(id: string, uid?: string | null): ActiveOrderLike[] {
  const existing = readActiveOrders(uid);
  const next = existing.filter((o) => o.id !== id);
  writeActiveOrders(next);
  return next;
}

export function latestActiveOrder(uid?: string | null): ActiveOrderLike | null {
  const all = readActiveOrders(uid);
  return all.length > 0 ? all[0] : null;
}
