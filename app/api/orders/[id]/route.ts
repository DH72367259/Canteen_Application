import { getRequestContext } from '@/lib/authServer';
import { getOrder } from '@/lib/db';
import type { NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: orderId } = await routeContext.params;
    const order = await getOrder(orderId);

    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Verify user owns this order or is staff that legitimately serves this canteen.
    const role = context.role;
    const isPlatformStaff = role === 'super_admin' || role === 'co_admin';
    const isOwnCanteenStaff =
      (role === 'canteen_admin' || role === 'vendor' || role === 'worker') &&
      !!context.canteenId &&
      (order as { canteen_id?: string }).canteen_id === context.canteenId;
    const isOwner = (order as { user_id?: string }).user_id === context.uid;
    if (!isOwner && !isPlatformStaff && !isOwnCanteenStaff) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    return Response.json({ order });
  } catch (error) {
    console.error('[GET /api/orders/:id] error:', error);
    return Response.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}
