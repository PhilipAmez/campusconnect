/// <reference types="https://deno.land/x/deno/cli/types/dts/lib.deno.d.ts" />

import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FFmpeg } from "https://deno.land/x/deno_ffmpeg@v0.5.0/mod.ts";


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create a Supabase admin client to perform privileged operations.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    // The webhook payload sends the record object directly as the body.
    // FIX: The record is the payload itself, not nested.
    const record = await req.json();
    const videoPath = record.name;
    const videoBucket = record.bucket_id; // Corrected from record.bucket

    console.log(`Processing video: ${videoPath} from bucket: ${videoBucket}`);

    // 1. Download the video from Supabase Storage
    const { data: videoFile, error: downloadError } = await supabaseAdmin.storage
      .from(videoBucket)
      .download(videoPath);

    if (downloadError) throw downloadError;
    if (!videoFile) throw new Error("Video file not found.");

    // Write the video to a temporary file for FFmpeg to process.
    const videoBuffer = await videoFile.arrayBuffer();
    const tempVideoPath = `/tmp/video_${Date.now()}.mp4`;
    await Deno.writeFile(tempVideoPath, new Uint8Array(videoBuffer));

    // 2. Generate the thumbnail using FFmpeg
    const tempThumbPath = `/tmp/thumb_${Date.now()}.jpg`;
    const ffmpeg = new FFmpeg();
    await ffmpeg.run({
        input: tempVideoPath,
        output: tempThumbPath,
        options: "-ss 00:00:01 -vframes 1" // Capture frame at 1 second
    });

    const thumbnailData = await Deno.readFile(tempThumbPath);

    // 3. Upload the thumbnail to the 'thumbnails' bucket
    const thumbnailPath = videoPath.replace(/\.[^/.]+$/, ".jpg");
    const { error: uploadError } = await supabaseAdmin.storage
      .from('thumbnails')
      .upload(thumbnailPath, thumbnailData, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 4. Get the public URL of the thumbnail
    const { data: urlData } = supabaseAdmin.storage
      .from('thumbnails')
      .getPublicUrl(thumbnailPath);

    // 5. Update the 'posts' table with the thumbnail URL
    // This assumes the video file is named after the post's UUID (e.g., `public/uuid.mp4`)
    const postId = videoPath.split('/').pop()?.replace(/\.[^/.]+$/, "") ?? '';
    if (!postId) throw new Error("Could not determine Post ID from video path.");

    const { error: dbError } = await supabaseAdmin
      .from('posts')
      .update({ thumbnail_url: urlData.publicUrl })
      .eq('id', postId);

    if (dbError) throw dbError;

    // Clean up temporary files
    await Deno.remove(tempVideoPath);
    await Deno.remove(tempThumbPath);

    console.log(`Thumbnail generated for post: ${postId}`);

    return new Response(
      JSON.stringify({ message: `Thumbnail created for ${postId}` }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});