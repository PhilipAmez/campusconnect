RLS policy help for `posts` table

If you see `new row violates row-level security policy` when inserting from the client, create a policy that allows authenticated users to insert rows where `author_id = auth.uid()`.

Recommended SQL (run in Supabase SQL editor):

-- Enable RLS (if not already enabled)
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to INSERT rows where author_id = auth.uid()
CREATE POLICY "Allow inserts by owner" ON public.posts
  FOR INSERT
  WITH CHECK (author_id = auth.uid());

-- Allow authenticated users to SELECT rows (optional)
CREATE POLICY "Allow select" ON public.posts
  FOR SELECT
  USING (true);

-- If you want to allow the user who created the row to update/delete it, add:
CREATE POLICY "Allow update by owner" ON public.posts
  FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Allow delete by owner" ON public.posts
  FOR DELETE
  USING (author_id = auth.uid());

Notes:
- Replace `posts` with your actual table name if different.
- These policies assume the client is authenticated and that `author_id` stores the user's `auth.uid()` (the Supabase user id).
- For testing only: you can disable RLS:
  ALTER TABLE public.posts DISABLE ROW LEVEL SECURITY;
  (Do not leave RLS disabled in production.)

Dashboard steps:
1. Open Supabase -> Database -> Tables -> public -> posts (or SQL editor).
2. In Table Editor -> Policies tab, click "New Policy" and enter the SQL condition equivalent to the above.
3. Alternatively paste the SQL in the SQL editor and run it.

If you'd like, I can prepare a SQL snippet that also enforces `created_at = now()` or other constraints.
