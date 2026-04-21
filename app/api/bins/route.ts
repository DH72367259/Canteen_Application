import { getRequestContext } from '@/lib/authServer';
import { getAllBins } from '@/lib/firestoreRepository';
import { canManageOrders } from '@/lib/roleChecks';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bins = await getAllBins();
    return Response.json({ bins });
  } catch (error) {
    console.error('Error fetching bins:', error);
    return Response.json(
      { error: 'Failed to fetch bins' },
      { status: 500 }
    );
  }
}
