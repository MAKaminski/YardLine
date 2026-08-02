import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Server-side Supabase client bound to the request's auth cookies. */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component render — safe to ignore.
          }
        },
      },
    }
  )
}
