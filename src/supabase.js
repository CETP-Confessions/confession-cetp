import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const authRequestTimeoutMs = 20000;

async function authFetch(input, init = {}) {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, authRequestTimeoutMs);
  const abortFromRequest = () => timeoutController.abort();

  if (init.signal?.aborted) timeoutController.abort();
  else init.signal?.addEventListener('abort', abortFromRequest, { once: true });

  try {
    return await fetch(input, { ...init, signal: timeoutController.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error('Supabase sign-in timed out. Check your connection and Supabase Auth availability, then try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    init.signal?.removeEventListener('abort', abortFromRequest);
  }
}

export const supabaseConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  isReady: Boolean(supabaseUrl && supabaseAnonKey),
};

export const supabase = supabaseConfig.isReady
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        fetch: authFetch,
      },
    })
  : null;
