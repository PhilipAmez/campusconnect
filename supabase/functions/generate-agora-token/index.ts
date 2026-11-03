import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { RtcTokenBuilder, RtcRole } from 'npm:agora-access-token'
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Supabase Edge Function that mints temporary Agora tokens.
 *
 * Previously this handed a PUBLISHER token to anyone who asked for any
 * channel/uid (verify_jwt only proves the caller has *a* Supabase JWT, and
 * the public anon key is one). Now the caller must be a signed-in user, must
 * ask for their own uid, and must belong to the group whose class they are
 * joining (channelName is the group id).
 */

const ALLOWED_ORIGINS = [
  'https://peerloom.online',
  'https://www.peerloom.online',
  // Optional, comma-separated, e.g. "http://localhost:5500" for local dev.
  ...(Deno.env.get('EXTRA_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
]

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    // 1. Parse + validate input
    const { channelName, uid } = await req.json()
    if (typeof channelName !== 'string' || typeof uid !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(channelName) || !uid) {
      return json(req, { error: 'Invalid parameters' }, 400)
    }

    // 2. Who is calling? Ask Supabase to validate the caller's own access token.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error('Supabase environment variables are missing.')
      return json(req, { error: 'Server configuration error' }, 500)
    }
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json(req, { error: 'Not signed in' }, 401)

    // 3. You can only ask for a token for yourself.
    if (uid !== user.id) return json(req, { error: 'Forbidden' }, 403)

    // 4. You must belong to this group (or have created it).
    //    Service role is used only for this narrow read, so RLS can't hide the row.
    const admin = createClient(supabaseUrl, serviceKey)
    const [{ data: member }, { data: group }] = await Promise.all([
      admin.from('group_members').select('user_id').eq('group_id', channelName).eq('user_id', user.id).limit(1).maybeSingle(),
      admin.from('groups').select('created_by').eq('id', channelName).maybeSingle(),
    ])
    if (!member && group?.created_by !== user.id) return json(req, { error: 'Forbidden' }, 403)

    // 5. Agora credentials (server-side only)
    const appId = Deno.env.get('AGORA_APP_ID')
    const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE')
    if (!appId || !appCertificate) {
      console.error('Agora App ID or Certificate not set in Supabase environment variables.')
      return json(req, { error: 'Server configuration error' }, 500)
    }

    // 6. Build a 1-hour token
    const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 3600
    const token = RtcTokenBuilder.buildTokenWithAccount(
      appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, privilegeExpiredTs,
    )
    return json(req, { token })
  } catch (error) {
    console.error('generate-agora-token failed:', error)
    return json(req, { error: 'Bad request' }, 400)
  }
})