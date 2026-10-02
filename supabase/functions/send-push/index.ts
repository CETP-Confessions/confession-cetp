import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!webhookSecret || request.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!publicKey || !privateKey || !subject || !supabaseUrl || !serviceRoleKey) {
    return new Response('Push function environment is not configured.', { status: 500 });
  }

  let payload: { type?: string; table?: string; record?: { id?: string; admin_id?: string } };
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }
  if (payload.type !== 'INSERT' || payload.table !== 'messages' || !payload.record?.admin_id) {
    return Response.json({ ignored: true });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('admin_id', payload.record.admin_id);
  if (error) return new Response(error.message, { status: 500 });

  const results = await Promise.all((subscriptions || []).map(async (entry) => {
    try {
      await webpush.sendNotification(entry.subscription, JSON.stringify({
        title: 'New message received',
        body: 'A new anonymous message is waiting in your inbox.',
        tag: `new-message-${payload.record?.id || 'inbox'}`,
      }));
      return 'sent';
    } catch (pushError) {
      const statusCode = (pushError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', entry.id);
        return 'expired';
      }
      console.error('Push delivery failed.', statusCode || 'unknown status');
      return 'failed';
    }
  }));

  return Response.json({ attempted: results.length, sent: results.filter((result) => result === 'sent').length });
});