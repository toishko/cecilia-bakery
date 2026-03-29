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

    // Handle both webhook formats:
    // Format 1 (direct): { type, table, record, old_record }
    // Format 2 (DB webhook): { type, table, record, old_record } (same but type might be uppercase)
    // Format 3 (trigger-based): { old_data, data, ... } wrapped in trigger_name etc.
    const type = (raw.type || '').toUpperCase()
    const table = raw.table || ''
    const record = raw.record || raw.data || raw.new || null
    const old_record = raw.old_record || raw.old_data || raw.old || null

    console.log(`Event: ${type} on ${table}`)

    if (table !== 'driver_orders') {
      console.log('Not driver_orders, skipping')
      return new Response('Not relevant', { status: 200, headers: corsHeaders })
    }

    // Idempotency guard: skip if this exact (record.id, type+detail) was processed recently
    const recordId = record?.id
    // Build a specific event key for dedup — e.g. "UPDATE:status=sent" or "INSERT"
    let eventKey = type
    if (type === 'UPDATE' && record) {
      if (record.status && record.status !== old_record?.status) {
        eventKey = `${type}:status=${record.status}`
      } else if (record.payment_status && record.payment_status !== old_record?.payment_status) {
        eventKey = `${type}:payment=${record.payment_status}`
      } else if (record.admin_notes && record.admin_notes !== old_record?.admin_notes) {
        eventKey = `${type}:notes`
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

      // Log this invocation
      await sb.from('notification_log').insert({
        order_id: recordId,
        event_type: eventKey
      }).select()
      console.log(`Idempotency: logged ${eventKey} for ${recordId}`)
    }

    // Determine who to notify
    let targets: { user_type: string; user_id?: string; title: string; body: string; url: string }[] = []

    if (type === 'INSERT' && record) {
      const driverName = record.business_name || 'Driver'
      targets.push({
        user_type: 'admin',
        title: '🆕 New Order',
        body: `New order from ${driverName}`,
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

    console.log(`Targets: ${targets.length}`, targets.map(t => `${t.user_type}:${t.user_id || 'all'}`))

    // Send push to each target
    let sent = 0
    let failed = 0

    for (const target of targets) {
      let query = sb.from('push_subscriptions').select('*').eq('user_type', target.user_type)
      if (target.user_id) query = query.eq('user_id', target.user_id)
      query = query.order('created_at', { ascending: false })

      const { data: subs, error } = await query
      console.log(`Found ${subs?.length || 0} subscriptions for ${target.user_type}`)
      if (error) { console.error('Sub lookup error:', error); continue }
      if (!subs || subs.length === 0) continue

      console.log(`Sending to ${subs.length} subscriptions`)

      for (const sub of subs) {
        const pushPayload = JSON.stringify({
          title: target.title,
          body: target.body,
          url: target.url,
          tag: `cecilia-order-${record?.id || Date.now()}`
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
