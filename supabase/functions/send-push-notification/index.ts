import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@ceciliabakery.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://ceciliabakery.com,https://www.ceciliabakery.com').split(',')

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
})

serve(async (req) => {
  const origin = req.headers.get('origin') || ''

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

  try {
    const raw = await req.json()
    console.log('Webhook payload received:', JSON.stringify(raw).slice(0, 500))

    const type = (raw.type || '').toUpperCase()
    const table = raw.table || ''
    const record = raw.record || raw.data || raw.new || null
    const old_record = raw.old_record || raw.old_data || raw.old || null

    console.log(`Event: ${type} on ${table}`)

    // Only process relevant tables
    if (table !== 'driver_orders' && table !== 'orders' && table !== 'wholesale_orders' && table !== 'driver_order_items') {
      console.log(`Table "${table}" not relevant, skipping`)
      return new Response('Not relevant', { status: 200, headers: corsHeaders(origin) })
    }

    // ── Idempotency guard ──
    const recordId = record?.id
    let eventKey = type
    if (type === 'UPDATE' && record) {
      if (table === 'driver_orders') {
        if (record.status && record.status !== old_record?.status) {
          eventKey = `${type}:status=${record.status}`
        } else if (record.payment_status && record.payment_status !== old_record?.payment_status) {
          eventKey = `${type}:payment=${record.payment_status}`
        } else if (record.admin_notes && record.admin_notes !== old_record?.admin_notes) {
          eventKey = `${type}:notes`
        }
      } else if (table === 'orders') {
        if (record.delivery_status && record.delivery_status !== old_record?.delivery_status) {
          eventKey = `${type}:delivery_status=${record.delivery_status}`
        }
      } else if (table === 'driver_order_items') {
        eventKey = `${type}:staff_edit:${record.order_id || ''}`
      }
    }

    if (recordId) {
      // For driver_orders, dedup on order_id only (ignore event_type)
      // so INSERT + UPDATE within 60s are treated as the same event
      let dedupQuery = sb
        .from('notification_log')
        .select('id')
        .eq('order_id', recordId)
        .gte('created_at', new Date(Date.now() - 60000).toISOString())

      if (table !== 'driver_orders') {
        dedupQuery = dedupQuery.eq('event_type', eventKey)
      }

      const { data: existing } = await dedupQuery.limit(1)

      if (existing && existing.length > 0) {
        console.log(`Idempotency: already processed ${eventKey} for ${recordId}, skipping`)
        return new Response(JSON.stringify({ skipped: true, reason: 'already_processed' }), {
          status: 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
        })
      }

      await sb.from('notification_log').insert({
        order_id: recordId,
        event_type: eventKey
      }).select()
      console.log(`Idempotency: logged ${eventKey} for ${recordId}`)
    }

    // ── Determine who to notify ──
    let targets: { user_type: string; user_id?: string; title: string; body: string; url: string; tag?: string }[] = []

    // ═══════════════════════════════════
    //  DRIVER_ORDER_ITEMS TABLE (staff edits)
    // ═══════════════════════════════════
    if (table === 'driver_order_items' && type === 'UPDATE' && record) {
      const editedBy = record.edited_by || 'Staff'
      const driverName = record.driver_name || 'a driver'
      targets.push({
        user_type: 'admin',
        title: '📝 Order Edited',
        body: `${driverName}'s order was edited by ${editedBy}`,
        url: '/admin-dashboard.html'
      })
    }

    // ═══════════════════════════════════
    //  DRIVER_ORDERS TABLE
    // ═══════════════════════════════════
    if (table === 'driver_orders') {
      if (type === 'INSERT' && record) {
        // Look up driver name for a more useful notification
        let driverName = 'a driver';
        if (record.driver_id) {
          const { data: driver } = await sb
            .from('drivers')
            .select('name')
            .eq('id', record.driver_id)
            .single();
          if (driver?.name) driverName = driver.name;
        }
        const bizInfo = record.business_name ? ` (${record.business_name})` : '';
        targets.push({
          user_type: 'admin',
          title: `🚚 New Order from ${driverName}`,
          body: `${driverName} placed a new order${bizInfo}`,
          url: '/admin-dashboard.html'
        })
        targets.push({
          user_type: 'staff',
          title: '🚚 New Order',
          body: `New order from ${driverName}`,
          url: '/staff',
          tag: 'new-order-' + record.id
        })
      }

      if (type === 'UPDATE' && record) {
        if (record.status === 'sent' && old_record?.status !== 'sent') {
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '✅ Order Confirmed',
            body: 'Your order has been confirmed by the bakery',
            url: '/driver-order.html'
          })
        }

        if (record.payment_status && record.payment_status !== old_record?.payment_status) {
          const bodyText = record.payment_status === 'paid'
            ? 'Your payment has been marked as paid'
            : record.payment_status === 'partial'
            ? 'A partial payment has been recorded'
            : 'Your payment status has been updated'
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '💰 Payment Update',
            body: bodyText,
            url: '/driver-order.html'
          })
        }

        if (record.admin_notes && record.admin_notes !== old_record?.admin_notes) {
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '📝 Order Updated',
            body: 'Your order was modified by the bakery',
            url: '/driver-order.html'
          })
        }
      }
    }

    // ═══════════════════════════════════
    //  ORDERS TABLE (online customer orders)
    // ═══════════════════════════════════
    if (table === 'orders') {
      if (type === 'INSERT' && record) {
        // Use customer first name for a more useful notification
        const customerName = record.customer_name
          ? record.customer_name.trim().split(/\s+/)[0]
          : 'a customer';
        targets.push({
          user_type: 'admin',
          title: `🛒 New Online Order from ${customerName}`,
          body: `${customerName} placed a new online order`,
          url: '/admin-dashboard.html'
        })
      }

      if (type === 'UPDATE' && record) {
        const newStatus = record.delivery_status
        const oldStatus = old_record?.delivery_status

        // Only notify customer if delivery_status actually changed
        if (newStatus && newStatus !== oldStatus) {
          const clerkUserId = record.clerk_user_id

          const statusMessages: Record<string, { title: string; body: string }> = {
            'preparing': {
              title: '👨‍🍳 Order Being Prepared',
              body: 'Your order is now being prepared!'
            },
            'ready': {
              title: '✅ Ready for Pickup!',
              body: 'Your order is ready! Come pick it up.'
            },
            'completed': {
              title: '🎉 Order Complete',
              body: 'Your order has been completed. Thank you!'
            },
            'cancelled': {
              title: '❌ Order Cancelled',
              body: 'Your order has been cancelled. Please contact us for details.'
            }
          }

          const msg = statusMessages[newStatus]
          if (msg && clerkUserId) {
            targets.push({
              user_type: 'customer',
              user_id: clerkUserId,
              title: msg.title,
              body: msg.body,
              url: `/order-confirmation.html?id=${record.id}`
            })
          }

          // Admin is not notified about status changes they make themselves
          // Only the customer is notified above
        }
      }
    }

    // ═══════════════════════════════════
    //  WHOLESALE_ORDERS TABLE
    // ═══════════════════════════════════
    if (table === 'wholesale_orders') {
      if (type === 'INSERT' && record) {
        // Look up business name from wholesale_accounts
        let bizName = 'a partner';
        if (record.account_id) {
          const { data: account } = await sb
            .from('wholesale_accounts')
            .select('business_name')
            .eq('id', record.account_id)
            .single();
          if (account?.business_name) bizName = account.business_name;
        }
        targets.push({
          user_type: 'admin',
          title: `🏪 New Partner Order from ${bizName}`,
          body: `${bizName} placed a new wholesale order`,
          url: '/admin-dashboard.html'
        })
      }
    }

    console.log(`Targets: ${targets.length}`, targets.map(t => `${t.user_type}:${t.user_id || 'all'}`))

    // ── Send push to each target ──
    let sent = 0
    let failed = 0

    for (const target of targets) {
      let query = sb.from('push_subscriptions').select('*').eq('user_type', target.user_type)
      if (target.user_id) query = query.eq('user_id', target.user_id)
      query = query.order('created_at', { ascending: false })

      const { data: subs, error } = await query
      console.log(`Found ${subs?.length || 0} subscriptions for ${target.user_type}${target.user_id ? ':' + target.user_id : ''}`)
      if (error) { console.error('Sub lookup error:', error); continue }
      if (!subs || subs.length === 0) continue

      console.log(`Sending to ${subs.length} subscriptions`)

      for (const sub of subs) {
        const pushPayload = JSON.stringify({
          title: target.title,
          body: target.body,
          url: target.url,
          tag: target.tag || `cecilia-${table}-${record?.id || Date.now()}`
        })

        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }

        try {
          await webpush.sendNotification(pushSub, pushPayload)
          console.log(`✅ Push sent to ${target.user_type}:${sub.user_id}`)
          sent++
        } catch (err: any) {
          console.error('Push send error:', err.statusCode, err.body)
          failed++
          if (err.statusCode === 404 || err.statusCode === 410) {
            await sb.from('push_subscriptions').delete().eq('id', sub.id)
            console.log(`Removed expired subscription ${sub.id}`)
          }
        }
      }
    }

    console.log(`Done: sent=${sent}, failed=${failed}`)
    return new Response(JSON.stringify({ sent, failed }), {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    })
  }
})
