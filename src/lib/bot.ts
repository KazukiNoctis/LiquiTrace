import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --------------------------------------------------------------------------
// Configuration & Constants
// --------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const REFERRAL_WALLET = process.env.NEXT_PUBLIC_REFERRAL_WALLET || "0xYourWalletHere";

const CHAIN_ID = "base";
const MIN_LIQUIDITY_USD = 2500;
const MIN_VOLUME_24H = 1000;
const TOP_N = 10;
const SWAP_FEE_BPS = 10;

const DEXSCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search";
const DEXSCREENER_BOOSTS_URL = "https://api.dexscreener.com/token-boosts/top/v1";
const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/tokens/v1/base";
const GECKOTERMINAL_TRENDING_URL = "https://api.geckoterminal.com/api/v2/networks/base/trending_pools";

// --------------------------------------------------------------------------
// Clients
// --------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --------------------------------------------------------------------------
// Helper Functions
// --------------------------------------------------------------------------

async function fetchBoostedTokens(): Promise<string[]> {
    try {
        const res = await fetch(DEXSCREENER_BOOSTS_URL);
        if (!res.ok) throw new Error("Boosts fetch failed");
        const data = await res.json();
        return data
            .filter((item: any) => item.chainId === CHAIN_ID)
            .map((item: any) => item.tokenAddress);
    } catch (e) {
        console.error("Fetch Boosted Error:", e);
        return [];
    }
}

async function fetchSearchGainers(): Promise<any[]> {
    const queries = [
        "WETH", "USDC",
        "trending", "base",
        "DEGEN", "BRETT", "TOSHI", "HIGHER",
        "meme", "social", "AI"
    ];

    const allPairs: any[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
        try {
            const res = await fetch(`${DEXSCREENER_SEARCH_URL}?q=${q}`);
            if (!res.ok) continue;
            const data = await res.json();
            const pairs = data.pairs || [];

            for (const pair of pairs) {
                if (pair.chainId !== CHAIN_ID) continue;
                if (seen.has(pair.pairAddress)) continue;
                seen.add(pair.pairAddress);
                allPairs.push(pair);
            }
        } catch (e) {
            console.warn(`Search '${q}' failed:`, e);
        }
    }
    return allPairs;
}

async function fetchGeckoTrending(): Promise<any[]> {
    try {
        const res = await fetch(GECKOTERMINAL_TRENDING_URL);
        if (!res.ok) return [];
        const json = await res.json();

        return json.data.map((pool: any) => {
            const attr = pool.attributes;
            const baseTokenId = pool.relationships?.base_token?.data?.id || "";
            const baseTokenAddr = baseTokenId.replace("base_", "");
            const priceChange = parseFloat(attr.price_change_percentage?.h24 || 0);

            return {
                chainId: CHAIN_ID,
                pairAddress: attr.address,
                baseToken: {
                    address: baseTokenAddr,
                    name: attr.name.split(" / ")[0],
                    symbol: attr.name.split(" / ")[0],
                },
                priceUsd: attr.base_token_price_usd,
                priceChange: { h24: priceChange },
                liquidity: { usd: parseFloat(attr.reserve_in_usd || 0) },
                volume: { h24: parseFloat(attr.volume_usd?.h24 || 0) },
                marketCap: parseFloat(attr.fdv_usd || 0),
                url: `https://dexscreener.com/base/${baseTokenAddr}`,
                _source: "geckoterminal"
            };
        });
    } catch (e) {
        console.warn("Gecko fetch failed:", e);
        return [];
    }
}

async function fetchTokenPairs(addresses: string[]): Promise<any[]> {
    if (addresses.length === 0) return [];
    const batch = addresses.slice(0, 30).join(",");
    try {
        const res = await fetch(`${DEXSCREENER_TOKENS_URL}/${batch}`);
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json) ? json : json.pairs || [];
    } catch (e) {
        console.error("Fetch Token Pairs Error:", e);
        return [];
    }
}

async function cleanupOldSignals() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await supabase.from("signals").delete().lt("updated_at", cutoff);
}

// --------------------------------------------------------------------------
// Main Scraper Function
// --------------------------------------------------------------------------

// export async function runBotScan() {
//    console.log("TEMPORARILY DISABLED FOR DEBUGGING");
//    return { success: true, processed: 0, top: [] };
// }
export async function runBotScan() {
    // console.log("Starting Scan...");
    return { success: true, processed: 0, top: [] }; // Mock return
}
