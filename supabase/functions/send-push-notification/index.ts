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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const raw = await req.json()
    console.log('Webhook payload received:', JSON.stringify(raw).slice(0, 500))

    const type = (raw.type || '').toUpperCase()
    const table = raw.table || ''
    const record = raw.record || raw.data || raw.new || null
    const old_record = raw.old_record || raw.old_data || raw.old || null

    console.log(`Event: ${type} on ${table}`)

    // Only process driver_orders and orders tables
    if (table !== 'driver_orders' && table !== 'orders') {
      console.log(`Table "${table}" not relevant, skipping`)
      return new Response('Not relevant', { status: 200, headers: corsHeaders })
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
      }
    }

    if (recordId) {
      const { data: existing } = await sb
        .from('notification_log')
        .select('id')
        .eq('order_id', recordId)
        .eq('event_type', eventKey)
        .gte('created_at', new Date(Date.now() - 60000).toISOString())
        .limit(1)

      if (existing && existing.length > 0) {
        console.log(`Idempotency: already processed ${eventKey} for ${recordId}, skipping`)
        return new Response(JSON.stringify({ skipped: true, reason: 'already_processed' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      await sb.from('notification_log').insert({
        order_id: recordId,
        event_type: eventKey
      }).select()
      console.log(`Idempotency: logged ${eventKey} for ${recordId}`)
    }

    // ── Determine who to notify ──
    let targets: { user_type: string; user_id?: string; title: string; body: string; url: string }[] = []

    // ═══════════════════════════════════
    //  DRIVER_ORDERS TABLE
    // ═══════════════════════════════════
    if (table === 'driver_orders') {
      if (type === 'INSERT' && record) {
        const driverName = record.business_name || 'Driver'
        targets.push({
          user_type: 'admin',
          title: '🚚 New Driver Order',
          body: `${driverName} placed a new order`,
          url: '/admin-dashboard.html'
        })
      }

      if (type === 'UPDATE' && record) {
        if (record.status === 'sent' && old_record?.status !== 'sent') {
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '✅ Order Confirmed',
            body: `Order #${record.id?.slice(0, 8)} has been confirmed`,
            url: '/driver-order.html'
          })
        }

        if (record.payment_status && record.payment_status !== old_record?.payment_status) {
          const statusLabel = record.payment_status === 'paid' ? 'Paid' :
                             record.payment_status === 'partial' ? 'Partially Paid' : 'Updated'
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '💰 Payment Update',
            body: `Order #${record.id?.slice(0, 8)}: ${statusLabel}`,
            url: '/driver-order.html'
          })
        }

        if (record.admin_notes && record.admin_notes !== old_record?.admin_notes) {
          targets.push({
            user_type: 'driver',
            user_id: record.driver_id,
            title: '📝 Order Modified',
            body: `Order #${record.id?.slice(0, 8)} was updated by admin`,
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
        // Notify ALL admins about new online order
        const customerName = record.customer_name || 'Customer'
        const total = record.total_amount ? `$${parseFloat(record.total_amount).toFixed(2)}` : ''
        targets.push({
          user_type: 'admin',
          title: '🛒 New Online Order',
          body: `${customerName}${total ? ' — ' + total : ''}`,
          url: '/admin-dashboard.html'
        })
      }

      if (type === 'UPDATE' && record) {
        const newStatus = record.delivery_status
        const oldStatus = old_record?.delivery_status

        // Only notify customer if delivery_status actually changed
        if (newStatus && newStatus !== oldStatus) {
          const clerkUserId = record.clerk_user_id
          const shortId = record.id?.slice(-8).toUpperCase() || '???'

          const statusMessages: Record<string, { title: string; body: string }> = {
            'preparing': {
              title: '👨‍🍳 Order Being Prepared',
              body: `Order #${shortId} is now being prepared!`
            },
            'ready': {
              title: '✅ Ready for Pickup!',
              body: `Order #${shortId} is ready! Come pick it up.`
            },
            'completed': {
              title: '🎉 Order Complete',
              body: `Order #${shortId} has been completed. Thank you!`
            },
            'cancelled': {
              title: '❌ Order Cancelled',
              body: `Order #${shortId} has been cancelled. Please contact us for details.`
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

          // Also notify admins about status changes (so other admin devices get notified)
          if (msg) {
            targets.push({
              user_type: 'admin',
              title: `📋 Order #${shortId}`,
              body: `Status changed to: ${newStatus}`,
              url: '/admin-dashboard.html'
            })
          }
        }
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
          tag: `cecilia-${table}-${record?.id || Date.now()}`
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
