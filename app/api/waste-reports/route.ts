import { getRequestContext } from '@/lib/authServer';
import { createWasteReport, getAllWasteReports } from '@/lib/firestoreRepository';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reports = await getAllWasteReports();
    return Response.json({ reports });
  } catch (error) {
    console.error('Error fetching waste reports:', error);
    return Response.json(
      { error: 'Failed to fetch waste reports' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { binId, weight, notes, canteenId } = body;

    if (!binId || weight === undefined || !canteenId) {
      return Response.json(
        { error: 'Missing required fields: binId, weight, canteenId' },
        { status: 400 }
      );
    }

    const report = await createWasteReport({
      binId,
      weight,
      notes: notes || '',
      workerId: context.uid,
      canteenId,
    });

    return Response.json({ report }, { status: 201 });
  } catch (error) {
    console.error('Error creating waste report:', error);
    return Response.json(
      { error: 'Failed to create waste report' },
      { status: 500 }
    );
  }
}
