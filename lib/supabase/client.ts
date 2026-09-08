import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Faltan variables de entorno de Supabase. Asegúrate de tener NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en tu archivo .env y reinicia el servidor de desarrollo (pnpm dev).'
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
