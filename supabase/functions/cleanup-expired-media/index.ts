import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const cleanupSecret = Deno.env.get('CLEANUP_FUNCTION_SECRET');
  if (!cleanupSecret || request.headers.get('authorization') !== `Bearer ${cleanupSecret}`) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Cleanup environment is not configured.', { status: 500, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const failures: string[] = [];
  let mediaRemoved = 0;
  let messagesRemoved = 0;

  async function removeStorageObject(path: string) {
    const separator = path.lastIndexOf('/');
    const folder = separator < 0 ? '' : path.slice(0, separator);
    const filename = separator < 0 ? path : path.slice(separator + 1);
    const { data: listed, error: listError } = await admin.storage
      .from('message-media')
      .list(folder, { search: filename, limit: 100 });
    if (listError) throw listError;
    if (!listed?.some((item) => item.name === filename)) return;
    const { error } = await admin.storage.from('message-media').remove([path]);
    if (error) throw error;
    mediaRemoved += 1;
  }

  const { data: expiredMessageMedia, error: messageMediaError } = await admin
    .from('messages')
    .select('id, media_path')
    .not('media_path', 'is', null)
    .lte('media_expires_at', now);
  if (messageMediaError) return new Response(messageMediaError.message, { status: 500, headers: corsHeaders });

  for (const message of expiredMessageMedia || []) {
    try {
      await removeStorageObject(message.media_path);
      const { error } = await admin.from('messages').update({ media_path: null, media_type: null })
        .eq('id', message.id).eq('media_path', message.media_path);
      if (error) throw error;
    } catch (error) {
      failures.push(`message-media:${message.id}:${String(error)}`);
    }
  }

  const { data: expiredCommentMedia, error: commentMediaError } = await admin
    .from('message_comments')
    .select('id, media_path')
    .not('media_path', 'is', null)
    .lte('media_expires_at', now);
  if (commentMediaError) return new Response(commentMediaError.message, { status: 500, headers: corsHeaders });

  for (const comment of expiredCommentMedia || []) {
    try {
      await removeStorageObject(comment.media_path);
      const { error } = await admin.from('message_comments').update({ media_path: null, media_type: null })
        .eq('id', comment.id).eq('media_path', comment.media_path);
      if (error) throw error;
    } catch (error) {
      failures.push(`comment-media:${comment.id}:${String(error)}`);
    }
  }

  const { data: expiredMessages, error: expirationError } = await admin
    .from('messages')
    .select('id, media_path')
    .eq('status', 'approved')
    .lte('approved_expires_at', now);
  if (expirationError) return new Response(expirationError.message, { status: 500, headers: corsHeaders });

  for (const message of expiredMessages || []) {
    try {
      if (message.media_path) {
        await removeStorageObject(message.media_path);
        const { error } = await admin.from('messages').update({ media_path: null, media_type: null })
          .eq('id', message.id).eq('media_path', message.media_path);
        if (error) throw error;
      }
      const { data: comments, error: commentsError } = await admin
        .from('message_comments').select('id, media_path').eq('message_id', message.id);
      if (commentsError) throw commentsError;
      let commentsReady = true;
      for (const comment of comments || []) {
        if (!comment.media_path) continue;
        try {
          await removeStorageObject(comment.media_path);
          const { error } = await admin.from('message_comments').update({ media_path: null, media_type: null })
            .eq('id', comment.id).eq('media_path', comment.media_path);
          if (error) throw error;
        } catch (error) {
          commentsReady = false;
          failures.push(`expired-comment-media:${comment.id}:${String(error)}`);
        }
      }
      if (!commentsReady) continue;
      const { error: deleteError } = await admin.from('messages').delete().eq('id', message.id);
      if (deleteError) throw deleteError;
      messagesRemoved += 1;
    } catch (error) {
      failures.push(`expired-message:${message.id}:${String(error)}`);
    }
  }

  const referencedPaths = new Set<string>();
  for (const table of ['messages', 'message_comments'] as const) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from(table).select('media_path')
        .not('media_path', 'is', null).range(offset, offset + 999);
      if (error) {
        failures.push(`list-references:${table}:${error.message}`);
        break;
      }
      for (const row of data || []) referencedPaths.add(row.media_path);
      if ((data || []).length < 1000) break;
    }
  }

  for (let folderOffset = 0; ; folderOffset += 100) {
    const { data: folders, error: folderError } = await admin.storage.from('message-media')
      .list('', { limit: 100, offset: folderOffset });
    if (folderError) {
      failures.push(`list-media-folders:${folderError.message}`);
      break;
    }
    for (const folder of folders || []) {
      if (folder.id !== null) continue;
      for (let fileOffset = 0; ; fileOffset += 100) {
        const { data: files, error: fileError } = await admin.storage.from('message-media')
          .list(folder.name, { limit: 100, offset: fileOffset });
        if (fileError) {
          failures.push(`list-media:${folder.name}:${fileError.message}`);
          break;
        }
        for (const file of files || []) {
          const path = `${folder.name}/${file.name}`;
          const oldEnough = file.created_at && Date.parse(file.created_at) <= Date.now() - 7 * 24 * 60 * 60 * 1000;
          if (oldEnough && !referencedPaths.has(path)) {
            try { await removeStorageObject(path); }
            catch (error) { failures.push(`orphan-media:${path}:${String(error)}`); }
          }
        }
        if ((files || []).length < 100) break;
      }
    }
    if ((folders || []).length < 100) break;
  }

  return Response.json({ mediaRemoved, messagesRemoved, failures }, { headers: corsHeaders });
});
