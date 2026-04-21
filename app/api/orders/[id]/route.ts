import { getRequestContext } from '@/lib/authServer';
import { getOrder } from '@/lib/firestoreRepository';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderId = params.id;
    const order = await getOrder(orderId);

    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Verify user owns this order or is admin
    if (order.customerId !== context.uid && context.role !== 'canteen-admin' && context.role !== 'super-admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    return Response.json({ order });
  } catch (error) {
    console.error('Error fetching order:', error);
    return Response.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}
