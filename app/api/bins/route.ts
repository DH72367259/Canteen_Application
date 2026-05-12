import { getRequestContext } from '@/lib/authServer';
import { getBins } from '@/lib/db';
import { createAdminClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canteenId = context.canteenId ?? '';
    const bins = canteenId ? await getBins(canteenId) : [];

    // Attach active order reference + customer name for worker handover checks.
    const orderIds = Array.from(new Set(
      bins
        .map((b) => String((b as { assigned_order_id?: string | null; order_id?: string | null }).assigned_order_id ?? (b as { order_id?: string | null }).order_id ?? ''))
        .filter((id) => id.length > 0),
    ));

    const orderMeta = new Map<string, { customer_name: string | null }>();
    if (orderIds.length > 0) {
      const supabase = createAdminClient();
      const { data: rows } = await supabase
        .from('orders')
        .select('id, profiles!orders_user_id_fkey(name)')
        .in('id', orderIds)
        .returns<Array<{ id: string; profiles: { name: string | null } | null }>>();
      for (const row of rows ?? []) {
        orderMeta.set(row.id, { customer_name: row.profiles?.name ?? null });
      }
    }

    const enriched = bins.map((b) => {
      const activeOrderId = String((b as { assigned_order_id?: string | null; order_id?: string | null }).assigned_order_id ?? (b as { order_id?: string | null }).order_id ?? '');
      const customer = orderMeta.get(activeOrderId)?.customer_name ?? null;
      return {
        ...b,
        active_order_id: activeOrderId || null,
        active_order_ref: activeOrderId ? activeOrderId.slice(-8).toUpperCase() : null,
        customer_name: customer,
      };
    });

    return Response.json({ bins: enriched });
  } catch (error) {
    void error;
    return Response.json(
      { error: 'Failed to fetch bins' },
      { status: 500 }
    );
  }
}
