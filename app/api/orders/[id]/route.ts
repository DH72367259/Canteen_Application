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

    // Verify user owns this order or is staff (any role that manages orders).
    const isStaff = (
      context.role === 'canteen_admin' ||
      context.role === 'vendor' ||
      context.role === 'worker' ||
      context.role === 'super_admin' ||
      context.role === 'co_admin'
    );
    if (order.user_id !== context.uid && !isStaff) {
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
