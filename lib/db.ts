import { createAdminClient } from './supabase-server'

// ============================================================
// Orders
// ============================================================
export async function getOrder(orderId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, order_items(*, menu_items(*)), profiles(name, email), time_slots(*), bins(*)'
    )
    .eq('id', orderId)
    .single()

  if (error) throw error
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


export async function addRewardTransaction(
  uid: string,
  type: 'earned' | 'redeemed' | 'expired',
  points: number,
  orderId?: string,
  reason?: string
) {
  const supabase = createAdminClient()

  // Reward points expire 7 days after earning
  const expiresAt =
    type === 'earned'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null

  const { error } = await supabase.from('reward_transactions').insert({
    user_id:    uid,
    type,
    points,
    order_id:   orderId ?? null,
    reason:     reason  ?? null,
    expires_at: expiresAt,
  })
  if (error) throw error

  // Atomically update wallet_balance (uses increment_wallet_balance SQL function)
  const delta =
    type === 'redeemed' || type === 'expired'
      ? -Math.abs(points)
      : Math.abs(points)

  const { error: rpcError } = await supabase.rpc('increment_wallet_balance', {
    p_user_id: uid,
    p_delta:   delta,
  })
  if (rpcError) throw rpcError
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
