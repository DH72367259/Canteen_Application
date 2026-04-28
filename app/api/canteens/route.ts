import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface CanteenRow {
  id: string;
  name: string;
  college: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  is_active: boolean;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GET /api/canteens
 * Public discovery endpoint for the user app.
 *
 * Query params (all optional):
 *   - college:  filter by exact college name (case-insensitive)
 *   - search:   substring search across name, college, city, address
 *   - lat,lng:  user coordinates
 *   - radius_km: cap distance (default 10 when lat+lng present)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const college   = searchParams.get("college")?.trim();
  const search    = searchParams.get("search")?.trim();
  const latStr    = searchParams.get("lat");
  const lngStr    = searchParams.get("lng");
  const radiusStr = searchParams.get("radius_km");

  const lat = latStr ? Number(latStr) : null;
  const lng = lngStr ? Number(lngStr) : null;
  const hasCoords = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const radiusKm = hasCoords ? (Number(radiusStr) || 10) : null;

  const supabase = createAdminClient();
  let query = supabase
    .from("canteens")
    .select("id, name, college, city, address, lat, lng, status, is_active");

  if (college) {
    query = query.ilike("college", college);
  }
  if (search) {
    const s = `%${search}%`;
    query = query.or(`name.ilike.${s},college.ilike.${s},city.ilike.${s},address.ilike.${s}`);
  }

  const { data, error } = await query.order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as CanteenRow[];
  const withDist = rows.map(c => {
    const distKm = hasCoords && c.lat !== null && c.lng !== null
      ? haversineKm(lat as number, lng as number, c.lat, c.lng)
      : null;
    return { ...c, distance_km: distKm };
  });

  const filtered = hasCoords && radiusKm !== null
    ? withDist.filter(c => c.distance_km !== null && c.distance_km <= radiusKm)
    : withDist;

  const sorted = hasCoords
    ? [...filtered].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    : filtered;

  return Response.json({ canteens: sorted, count: sorted.length });
}
