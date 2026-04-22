import { getRequestContext } from '@/lib/authServer';
import { getTimeSlots } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get slots for today and tomorrow
    const today = new Date();
    const canteenId = context.canteenId;
    const allSlots = canteenId ? await getTimeSlots(canteenId) : [];

    // Filter to show upcoming slots
    const nowHour = today.getHours();
    const availableSlots = allSlots.filter((slot: Record<string, unknown>) => {
      const startTime = String(slot.start_time ?? "");
      const [startHour] = startTime.split(':').map(Number);
      return !isNaN(startHour) ? startHour >= nowHour : true;
    });

    return Response.json({ slots: availableSlots });
  } catch (error) {
    void error;
    return Response.json(
      { error: 'Failed to fetch time slots' },
      { status: 500 }
    );
  }
}
