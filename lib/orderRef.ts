/** Returns the canonical short order reference shown to all roles. */
export function orderRef(id: string): string {
  return id.slice(-8).toUpperCase();
}
