import { getRequestContext } from '@/lib/authServer';
import { createAdminClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: reports, error } = await supabase
      .from('waste_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ reports: reports ?? [] });
  } catch (error) {
    void error;
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

    const supabase = createAdminClient();
    const { data: report, error } = await supabase
      .from('waste_reports')
      .insert({
        bin_id:     binId,
        weight_kg:  weight,
        notes:      notes ?? '',
        worker_id:  context.uid,
        canteen_id: canteenId,
      })
      .select()
      .single();
    if (error) throw error;

    return Response.json({ report }, { status: 201 });
  } catch (error) {
    void error;
    return Response.json(
      { error: 'Failed to create waste report' },
      { status: 500 }
    );
  }
}

