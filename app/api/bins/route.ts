import { getRequestContext } from '@/lib/authServer';
import { getBins } from '@/lib/db';
import { canManageOrders } from '@/lib/roleChecks';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canteenId = context.canteenId ?? '';
    const bins = canteenId ? await getBins(canteenId) : [];
    return Response.json({ bins });
  } catch (error) {
    void error;
    return Response.json(
      { error: 'Failed to fetch bins' },
      { status: 500 }
    );
  }
}
