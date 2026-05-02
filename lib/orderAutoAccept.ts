type QueryLike = {
  eq: (column: string, value: unknown) => QueryLike;
  lte: (column: string, value: string) => QueryLike;
  select: (columns: string) => PromiseLike<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
};

type SupabaseLike = {
  from: (table: string) => {
    update: (payload: Record<string, unknown>) => QueryLike;
  };
};

export interface AutoAcceptOptions {
  supabase: SupabaseLike;
  canteenId?: string;
  userId?: string;
  ageSeconds?: number;
}

/**
 * Auto-promotes stale `placed` orders to `confirmed` so canteen staff do not
 * need to manually accept every order.
 */
export async function autoAcceptPlacedOrders(options: AutoAcceptOptions): Promise<{ updatedCount: number }> {
  const { supabase, canteenId, userId, ageSeconds = 35 } = options;
  const cutoffIso = new Date(Date.now() - ageSeconds * 1000).toISOString();

  const runUpdate = async (withUpdatedAt: boolean) => {
    const updates: Record<string, unknown> = { status: "confirmed" };
    if (withUpdatedAt) {
      updates.updated_at = new Date().toISOString();
    }

    let query = supabase
      .from("orders")
      .update(updates)
      .eq("status", "placed")
      .lte("created_at", cutoffIso);

    if (canteenId) {
      query = query.eq("canteen_id", canteenId);
    }
    if (userId) {
      query = query.eq("user_id", userId);
    }

    return query.select("id");
  };

  const primary = await runUpdate(true);
  if (!primary.error) {
    return { updatedCount: primary.data?.length ?? 0 };
  }

  if (/updated_at|column .* does not exist/i.test(primary.error.message)) {
    const retry = await runUpdate(false);
    if (!retry.error) {
      return { updatedCount: retry.data?.length ?? 0 };
    }
    throw new Error(retry.error.message);
  }

  throw new Error(primary.error.message);
}