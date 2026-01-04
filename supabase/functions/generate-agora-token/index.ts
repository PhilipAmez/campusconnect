import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { RtcTokenBuilder, RtcRole } from 'npm:agora-access-token'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 *  Supabase Edge Function that generates temporary Agora Tokens
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
  // 1. Extract data from request
  const { channelName, uid } = await req.json()

  // 2. Validate
  if (!channelName || !uid) {
    return new Response("Missing parameters", { status: 400, headers: corsHeaders })
  }

  // 3. Set Variables - Get these from Agora Console
  const appId = Deno.env.get("AGORA_APP_ID");
  const appCertificate = Deno.env.get("AGORA_APP_CERTIFICATE");

  if (!appId || !appCertificate) {
    console.error("Agora App ID or Certificate not set in Supabase environment variables.")
    return new Response("Server configuration error", { status: 500, headers: corsHeaders });
  }

  const expirationTimeInSeconds = 3600
  const currentTimestamp = Math.floor(Date.now() / 1000)
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds

  // 4. Build token
  const token = RtcTokenBuilder.buildTokenWithAccount(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  )

  // 5. Respond
  return new Response(
    JSON.stringify({ token }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})