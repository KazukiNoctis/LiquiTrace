import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Lazily create the Supabase browser client.
 * Avoids crashing at build time when NEXT_PUBLIC_* env vars are absent.
 */
export function getSupabase(): SupabaseClient {
    if (_client) return _client;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "";

    if (!url || !key) {
        throw new Error(
            "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY"
        );
    }

    _client = createClient(url, key);
    return _client;
}
