// /js/supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm'

// Your Supabase URL and anon key
const supabaseUrl = 'https://mdofjippejpqylwuzsqp.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kb2ZqaXBwZWpwcXlsd3V6c3FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI2NjcyNzAsImV4cCI6MjA2ODI0MzI3MH0.PKtUqmGKciAQH3f_kz2q9VeYSdOcYHQDCJFu6UHcAw4'

// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Optional: Add a simple toast function if you don't have toast.js
export function showToast(message, type = 'success') {
  console.log(`${type}: ${message}`)
  // You can implement actual toast notifications here
}
