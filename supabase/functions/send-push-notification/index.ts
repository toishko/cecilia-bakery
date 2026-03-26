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

serve(async (req) => {
  try {
    const payload = await req.json()
    const { type, table, record, old_record } = payload

    if (table !== 'driver_orders') {
      return new Response('Not relevant', { status: 200 })
    }

    // Determine who to notify and what happened
    let targets: { user_type: string; user_id?: string; title: string; body: string; url: string }[] = []

    if (type === 'INSERT' && record) {
      // New order → notify all admins
      const driverName = record.business_name || 'Driver'
      targets.push({
        user_type: 'admin',
        title: '🆕 New Order',
        body: `New order from ${driverName}`,
        url: '/admin-dashboard.html'
      })
    }

    if (type === 'UPDATE' && record) {
      // Order status changed to 'sent' → notify the driver
      if (record.status === 'sent' && old_record?.status !== 'sent') {
        targets.push({
          user_type: 'driver',
          user_id: record.driver_id,
          title: '✅ Order Confirmed',
          body: `Order #${record.id?.slice(0, 8)} has been confirmed`,
          url: '/driver-order.html'
        })
      }

      // Payment status changed → notify the driver
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

      // Admin qty adjusted → notify the driver
      if (type === 'UPDATE' && record.admin_notes && record.admin_notes !== old_record?.admin_notes) {
        targets.push({
          user_type: 'driver',
          user_id: record.driver_id,
          title: '📝 Order Modified',
          body: `Order #${record.id?.slice(0, 8)} was updated by admin`,
          url: '/driver-order.html'
        })
      }
    }

    // Send push to each target
    let sent = 0
    let failed = 0

    for (const target of targets) {
      // Look up push subscriptions
      let query = sb.from('push_subscriptions').select('*').eq('user_type', target.user_type)
      if (target.user_id) query = query.eq('user_id', target.user_id)

      const { data: subs, error } = await query
      if (error || !subs) continue

      for (const sub of subs) {
        const pushPayload = JSON.stringify({
          title: target.title,
          body: target.body,
          url: target.url,
          tag: `cecilia-${target.user_type}-${Date.now()}`
        })

        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }

        try {
          await webpush.sendNotification(pushSub, pushPayload)
          sent++
        } catch (err: any) {
          console.error('Push send error:', err.statusCode, err.body)
          failed++
          // Remove expired/invalid subscriptions
          if (err.statusCode === 404 || err.statusCode === 410) {
            await sb.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
