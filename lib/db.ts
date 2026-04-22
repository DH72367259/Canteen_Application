import { createAdminClient } from './supabase-server'

// ============================================================
// Types
// ============================================================
interface OrderItem {
  menu_item_id: string
  quantity: number
  unit_price: number
}

interface CreateOrderData {
  user_id: string
  canteen_id: string
  slot_id?: string
  total_amount: number
  notes?: string
  payment_id?: string
  items: OrderItem[]
}

// ============================================================
// Orders
// ============================================================
export async function createOrder(orderData: CreateOrderData): Promise<string> {
  const supabase = createAdminClient()
  const { items, ...orderFields } = orderData

  const { data: order, error } = await supabase
    .from('orders')
    .insert(orderFields)
    .select('id')
    .single()

  if (error) throw error

  if (items?.length) {
    const orderItems = items.map((item) => ({ ...item, order_id: order.id }))
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)
    if (itemsError) throw itemsError
  }

  return order.id as string
}

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

export async function getUserOrders(uid: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, order_items(*, menu_items(name, price, image_url)), time_slots(slot_name, start_time, end_time)'
    )
    .eq('user_id', uid)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function getCanteenOrders(canteenId: string, status?: string) {
  const supabase = createAdminClient()
  let query = supabase
    .from('orders')
    .select(
      '*, order_items(*, menu_items(name, price)), profiles(name, email, phone), bins(bin_code, color)'
    )
    .eq('canteen_id', canteenId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  updates?: Record<string, unknown>
) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .update({ status, ...updates })
    .eq('id', orderId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getActiveOrderForUser(uid: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, order_items(*, menu_items(name, price, image_url)), bins(bin_code, color)'
    )
    .eq('user_id', uid)
    .not('status', 'in', '(collected,cancelled)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

export async function updateBin(
  binId: string,
  data: Record<string, unknown>
) {
  const supabase = createAdminClient()
  const { data: updated, error } = await supabase
    .from('bins')
    .update(data)
    .eq('id', binId)
    .select()
    .single()

  if (error) throw error
  return updated
}

// ============================================================
// Menu
// ============================================================
export async function getMenuItems(canteenId: string, category?: string) {
  const supabase = createAdminClient()
  let query = supabase
    .from('menu_items')
    .select('*')
    .eq('canteen_id', canteenId)
    .eq('is_available', true)
    .order('name')

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query
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
// Rewards
// ============================================================
export async function getUserRewardBalance(uid: string): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('wallet_balance')
    .eq('id', uid)
    .single()

  if (error) throw error
  return data?.wallet_balance ?? 0
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
