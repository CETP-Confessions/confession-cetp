import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const lockoutSeconds = 5 * 60;
const authWindowMinutes = 15;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function hashValue(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

async function sendLoginAlert() {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.ADMIN_LOGIN_ALERT_EMAIL;
  const sender = process.env.RESEND_FROM_EMAIL;
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
        text: `Three failed sign-in attempts were made against the CETP Confessions admin login. Access is temporarily locked for ${lockoutSeconds / 60} minutes. No password was recorded or included in this notification.`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { message: 'Method not allowed.' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missingConfiguration = [
    !supabaseUrl && 'SUPABASE_URL',
    !anonKey && 'SUPABASE_ANON_KEY',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missingConfiguration.length) {
    console.error('[admin-login] Missing Vercel environment variables:', missingConfiguration.join(', '));
    return json(res, 503, {
      message: `Admin login is misconfigured on Vercel. Add ${missingConfiguration.join(', ')} to the project environment, then redeploy.`,
      code: 'missing_server_environment',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return json(res, 400, { message: 'Invalid sign-in request.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(res, 400, { message: 'Invalid sign-in request.' });
  }
  const action = body.action === 'check-lockout' ? 'check-lockout' : 'sign-in';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 320 || (action === 'sign-in' && (!password || password.length > 1024))) {
    return json(res, 400, { message: 'Email and password are required.' });
  }

  const emailHash = hashValue(`email:${email}`, serviceRoleKey);
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = req.headers['x-real-ip'] || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const ipHash = hashValue(`ip:${ip}`, serviceRoleKey);
  const alertRecipient = process.env.ADMIN_LOGIN_ALERT_EMAIL?.trim().toLowerCase() || '';
  const alertConfigured = email === alertRecipient
    && Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lockout, error: lockoutError } = await admin.rpc('check_admin_login_lockout', {
    p_email_hash: emailHash,
  });
  if (lockoutError) {
    console.error('[admin-login] Lockout check RPC failed:', { code: lockoutError.code, message: lockoutError.message });
    return json(res, 503, {
      message: 'Admin login protection is unavailable. Apply the Supabase migrations with `supabase db push`, then retry.',
      code: 'lockout_migration_unavailable',
    });
  }
  if (action === 'check-lockout') {
    return json(res, 200, {
      locked: Boolean(lockout?.locked),
      retryAfterSeconds: Number(lockout?.retryAfterSeconds) || 0,
    });
  }
  if (lockout?.locked) {
    return json(res, 429, {
      message: 'Too many failed attempts. Please wait before trying again.',
      retryAfterSeconds: Number(lockout.retryAfterSeconds) || lockoutSeconds,
    });
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
    if (recordError) {
      console.error('[admin-login] Failed to record sign-in attempt:', { code: recordError.code, message: recordError.message });
      return json(res, 503, {
        message: 'Admin login protection is unavailable. Check the Supabase migration status and Vercel function logs.',
        code: 'lockout_migration_unavailable',
      });
    }

    if (failure?.shouldNotify) await sendLoginAlert();
    const retryAfterSeconds = Number(failure?.retryAfterSeconds) || 0;
    return json(res, retryAfterSeconds > 0 ? 429 : 401, {
      message: retryAfterSeconds > 0
        ? 'Too many failed attempts. Please wait before trying again.'
        : 'Sign-in failed. Check your credentials and try again.',
      retryAfterSeconds,
      attemptsRemaining: Math.max(0, 3 - (Number(failure?.attempts) || 0)),
      windowMinutes: authWindowMinutes,
    });
  }

  await admin.rpc('clear_admin_login_failures', { p_email_hash: emailHash });
  return json(res, 200, {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}