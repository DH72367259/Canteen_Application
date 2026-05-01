import { createAdminClient } from './supabase-server'

// ============================================================
// Orders
// ============================================================
export async function getOrder(orderId: string) {
  const supabase = createAdminClient()
  // Try with order_bins (Phase 7) first, then progressively fall back so older
  // dev DBs still work. Phase 7 column drift on `orders` (bin_count,
  // extra_bin_fee_paise) is tolerated by Postgres because we SELECT *.
  const projections = [
    '*, order_items(*, menu_items(*)), profiles(name, email), time_slots(*), bins!orders_bin_id_fkey(*), order_bins(bin_index, bin_code, bin_color, items)',
    '*, order_items(*, menu_items(*)), profiles(name, email), time_slots(*), bins!orders_bin_id_fkey(*)',
  ]
  let data: Record<string, unknown> | null = null
  let error: { message: string; code?: string } | null = null
  for (const proj of projections) {
    const r = await supabase.from('orders').select(proj).eq('id', orderId).maybeSingle()
    if (!r.error) { data = (r.data ?? null) as Record<string, unknown> | null; error = null; break }
    error = r.error as { message: string; code?: string }
    if (!/relation .* does not exist|column .* does not exist/i.test(r.error.message)) break
  }

  if (error) {
    // Treat "no rows" and "invalid uuid input" as not-found rather than 500.
    const msg = String(error.message ?? '').toLowerCase()
    if (error.code === 'PGRST116' || msg.includes('invalid input syntax for type uuid')) {
      return null
    }
    throw error
  }
  return data
}

// ============================================================
// Bins
// ============================================================
export async function getBins(canteenId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bins')
    .select('*')
    .eq('canteen_id', canteenId)
    .order('bin_code')

  if (error) throw error
  return data ?? []
}

// ============================================================
// Slots
// ============================================================
export async function getTimeSlots(canteenId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('time_slots')
    .select('*')
    .eq('canteen_id', canteenId)
    .eq('is_active', true)
    .order('start_time')

  if (error) throw error
  return data ?? []
}

// ============================================================
// OTP verification
// ============================================================
export async function verifyOrderOtp(
  otp: string,
  canteenId: string
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('verify_order_otp', {
    p_otp:       otp,
    p_canteen_id: canteenId,
  })

  if (error) throw error
  return data as string
}

// ============================================================
// Canteen stats
// ============================================================
export async function getCanteenStats(canteenId: string) {
  const supabase = createAdminClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [todayResult, pendingResult, completedResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total_amount, status')
      .eq('canteen_id', canteenId)
      .gte('created_at', todayISO),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('canteen_id', canteenId)
      .in('status', [
        'placed',
        'confirmed',
        'preparing',
        'ready_for_placement',
        'placed_in_bin',
        'ready_for_pickup',
      ]),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('canteen_id', canteenId)
      .eq('status', 'collected'),
  ])

  const todayOrders = todayResult.data?.length ?? 0
  const todayEarnings =
    todayResult.data?.reduce(
      (sum, o) => sum + (Number(o.total_amount) ?? 0),
      0
    ) ?? 0

  return {
    todayOrders,
    todayEarnings,
    pendingOrders:   pendingResult.count   ?? 0,
    completedOrders: completedResult.count ?? 0,
  }
}
