import { getRequestContext } from '@/lib/authServer';
import { getAvailableTimeSlots } from '@/lib/firestoreRepository';

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get slots for today and tomorrow
    const today = new Date();
    const slots = await getAvailableTimeSlots();

    // Filter to show upcoming slots
    const availableSlots = slots.filter((slot: any) => {
      const [startHour] = slot.startTime.split(':').map(Number);
      const now = today.getHours();
      return startHour >= now;
    });

    return Response.json({ slots: availableSlots });
  } catch (error) {
    console.error('Error fetching slots:', error);
    return Response.json(
      { error: 'Failed to fetch time slots' },
      { status: 500 }
    );
  }
}
