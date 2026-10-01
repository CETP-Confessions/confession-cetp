import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const LOCKOUT_SECONDS = 5 * 60;
const AUTH_WINDOW_MINUTES = 15;
const encoder = new TextEncoder();

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hashValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendLoginAlert() {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const recipient = Deno.env.get('ADMIN_LOGIN_ALERT_EMAIL');
  const sender = Deno.env.get('RESEND_FROM_EMAIL');
  if (!apiKey || !recipient || !sender) return false;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: 'Admin login security alert',
        text: `Three failed sign-in attempts were made against the CETP Confessions admin login. Access is temporarily locked for ${LOCKOUT_SECONDS / 60} minutes. No password was recorded or included in this notification.`,
      }),
    });
    return response.ok;
  } catch {
    // A mail outage must not bypass the server-side lockout.
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ message: 'Admin sign-in is temporarily unavailable.' }, 503);
  }

  let body: { action?: unknown; email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: 'Invalid sign-in request.' }, 400);
  }

  const action = body.action === 'check-lockout' ? 'check-lockout' : 'sign-in';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 320 || (action === 'sign-in' && (!password || password.length > 1024))) {
    return jsonResponse({ message: 'Email and password are required.' }, 400);
  }

  const emailHash = await hashValue(`email:${email}`, serviceRoleKey);
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const ipHash = await hashValue(`ip:${ip}`, serviceRoleKey);
  const alertRecipient = Deno.env.get('ADMIN_LOGIN_ALERT_EMAIL')?.trim().toLowerCase() || '';
  const alertConfigured = Boolean(
    email === alertRecipient
    && Deno.env.get('RESEND_API_KEY')
    && Deno.env.get('RESEND_FROM_EMAIL'),
  );
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lockout, error: lockoutError } = await admin.rpc('check_admin_login_lockout', {
    p_email_hash: emailHash,
  });
  if (lockoutError) return jsonResponse({ message: 'Admin sign-in is temporarily unavailable.' }, 503);
  if (action === 'check-lockout') {
    return jsonResponse({
      locked: Boolean(lockout?.locked),
      retryAfterSeconds: Number(lockout?.retryAfterSeconds) || 0,
    });
  }
  if (lockout?.locked) {
    return jsonResponse({
      message: 'Too many failed attempts. Please wait before trying again.',
      retryAfterSeconds: Number(lockout.retryAfterSeconds) || LOCKOUT_SECONDS,
    }, 429);
  }

  const auth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.session.refresh_token) {
    const { data: failure, error: recordError } = await admin.rpc('record_admin_login_failure', {
      p_email_hash: emailHash,
      p_ip_hash: ipHash,
      p_alert_enabled: alertConfigured,
    });
    if (recordError) return jsonResponse({ message: 'Admin sign-in is temporarily unavailable.' }, 503);

    if (failure?.shouldNotify) await sendLoginAlert();
    const retryAfterSeconds = Number(failure?.retryAfterSeconds) || 0;
    return jsonResponse({
      message: retryAfterSeconds > 0
        ? 'Too many failed attempts. Please wait before trying again.'
        : 'Sign-in failed. Check your credentials and try again.',
      retryAfterSeconds,
      attemptsRemaining: Math.max(0, 3 - (Number(failure?.attempts) || 0)),
      windowMinutes: AUTH_WINDOW_MINUTES,
    }, retryAfterSeconds > 0 ? 429 : 401);
  }

  await admin.rpc('clear_admin_login_failures', { p_email_hash: emailHash });
  return jsonResponse({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
});
