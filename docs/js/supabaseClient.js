// /js/supabaseClient.js  ───────────────
// The anon/public key is safe to use client-side;.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import './toast.js';



//  anon/public key
export const supabase = createClient(
  'https://mdofjippejpqylwuzsqp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kb2ZqaXBwZWpwcXlsd3V6c3FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI2NjcyNzAsImV4cCI6MjA2ODI0MzI3MH0.PKtUqmGKciAQH3f_kz2q9VeYSdOcYHQDCJFu6UHcAw4'
)
