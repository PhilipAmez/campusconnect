// /js/supabaseClient.js  ───────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export const supabase = createClient(
  /* 1 */ 'https://mdofjippejpqylwuzsqp.supabase.co',     // ← Supabase URL
  /* 2 */ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kb2ZqaXBwZWpwcXlsd3V6c3FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI2NjcyNzAsImV4cCI6MjA2ODI0MzI3MH0.PKtUqmGKciAQH3f_kz2q9VeYSdOcYHQDCJFu6UHcAw4'                      // ← anon / public key
)
