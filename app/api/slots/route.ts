import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function formatLabel(start_time: string): string {
  const [h, m] = start_time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${(m || 0).toString().padStart(2, "0")} ${ampm}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const canteenId = searchParams.get("canteenId");
  if (!canteenId) return Response.json({ error: "canteenId is required" }, { status: 400 });

  const supabase = createAdminClient();

  // Fetch active slots for the canteen
  const { data: slots, error } = await supabase
    .from("time_slots")
    .select("id, label, start_time, capacity, is_active")
    .eq("canteen_id", canteenId)
    .eq("is_active", true)
    .order("start_time");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!slots?.length) return Response.json({ slots: [] });

  // Current time in IST (UTC+5:30) as minutes since midnight
  const utcNow = new Date();
  const istMins = (utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes() + 330) % 1440;
  // A slot is bookable only if it starts >= 5 minutes from now
  const cutoff = istMins + 5;

  // Count today's non-cancelled orders per slot label to detect full slots
  const todayIST = new Date(utcNow.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const { data: orderRows } = await supabase
    .from("orders")
    .select("slot")
    .eq("canteen_id", canteenId)
    .gte("created_at", `${todayIST}T00:00:00+05:30`)
    .not("status", "in", '("cancelled","refunded")');

  const countMap: Record<string, number> = {};
  for (const o of orderRows ?? []) {
    if (o.slot) countMap[o.slot] = (countMap[o.slot] ?? 0) + 1;
  }

  const result = slots
    .map(s => {
      const [h, m] = (s.start_time as string).split(":").map(Number);
      const slotMins = h * 60 + (m || 0);
      const isPast = slotMins < cutoff;
      const label: string = (s.label as string) || formatLabel(s.start_time as string);
      const booked = countMap[label] ?? 0;
      const isFull = Number(s.capacity) > 0 && booked >= Number(s.capacity);
      return { id: s.id as string, label, start_time: s.start_time, available: !isPast && !isFull, is_full: isFull, capacity: s.capacity };
    })
    .filter(s => !((s.start_time as string).split(":").map(Number)[0] * 60 + ((s.start_time as string).split(":").map(Number)[1] || 0) < cutoff));

  return Response.json({ slots: result });
}
