import { NextResponse } from "next/server";
import { runBotScan } from "@/lib/bot";

const CRON_SECRET = process.env.CRON_SECRET;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    // 1. Security Check
    const authHeader = req.headers.get("authorization");
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const result = await runBotScan();
        return NextResponse.json(result);
    } catch (error) {
        console.error("Scan failed:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

// --------------------------------------------------------------------------
// Configuration & Constants
// --------------------------------------------------------------------------

// Environment Variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!; // Prefer Service Role for Cron, fallback to Anon for local dev
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;
const REFERRAL_WALLET = process.env.NEXT_PUBLIC_REFERRAL_WALLET || "0xYourWalletHere";

// Bot Logic Constants
const CHAIN_ID = "base";
const MIN_LIQUIDITY_USD = 2500; // > 1 ETH
const MIN_VOLUME_24H = 1000;    // > $1k
const TOP_N = 10;
const SWAP_FEE_BPS = 10; // 0.1%

// Endpoints
const DEXSCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search";
const DEXSCREENER_BOOSTS_URL = "https://api.dexscreener.com/token-boosts/top/v1";
const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/tokens/v1/base";
const GECKOTERMINAL_TRENDING_URL = "https://api.geckoterminal.com/api/v2/networks/base/trending_pools";

export const maxDuration = 60; // Allow 60s timeout (Vercel max for Hobby is 10s/60s depending on setup, pro is higher)
export const dynamic = "force-dynamic";

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
        "WETH", "USDC", // Core
        "trending", "base",
        "DEGEN", "BRETT", "TOSHI", "HIGHER", // Ecosystem
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
            // Normalize to DexScreener-ish shape
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
                marketCap: parseFloat(attr.fdv_usd || 0), // Fallback to FDV
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

// --------------------------------------------------------------------------
// Core Logic
// --------------------------------------------------------------------------

export async function GET(req: Request) {
    // 1. Security Check
    const authHeader = req.headers.get("authorization");
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("Starting Scan...");

    // 2. Fetch Data (Parallel)
    const [boostedAddrs, searchPairs, geckoPairs] = await Promise.all([
        fetchBoostedTokens(),
        fetchSearchGainers(),
        fetchGeckoTrending()
    ]);

    const boostedPairs = await fetchTokenPairs(boostedAddrs);

    // 3. Merge & Deduplicate
    const allPairs = [...boostedPairs, ...searchPairs, ...geckoPairs];
    const uniquePairs = new Map<string, any>(); // Key by baseToken address

    for (const pair of allPairs) {
        const baseAddr = pair.baseToken?.address;
        if (!baseAddr) continue;
        if (!uniquePairs.has(baseAddr)) {
            uniquePairs.set(baseAddr, pair);
        }
    }

    // 4. Filter & Sort
    const candidates = Array.from(uniquePairs.values())
        .map(pair => {
            const liq = parseFloat(pair.liquidity?.usd || 0);
            const vol = parseFloat(pair.volume?.h24 || 0);
            const change = parseFloat(pair.priceChange?.h24 || 0);
            return { pair, liq, vol, change };
        })
        .filter(p =>
            p.liq >= MIN_LIQUIDITY_USD &&
            p.vol >= MIN_VOLUME_24H &&
            !isNaN(p.change)
        )
        .sort((a, b) => b.change - a.change) // Descending
        .slice(0, TOP_N);

    if (candidates.length === 0) {
        // Cleanup anyway
        await cleanupOldSignals();
        return NextResponse.json({ success: true, message: "No gainers found" });
    }

    // 5. Process Top N (Summary + Save)
    const finalResults = []; // Renamed to avoid reserved word conflict if any
    for (const { pair, change, vol, liq } of candidates) {
        const base = pair.baseToken;
        const name = base.name || "Unknown";
        const symbol = base.symbol || "???";

        // AI Summary
        let summary = "";
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a concise crypto analyst. Describe the token and momentum in ONE sentence." },
                    { role: "user", content: `Token: ${name} (${symbol})\nChange: ${change.toFixed(1)}%\nVol: $${vol}` }
                ],
                max_tokens: 120
            });
            summary = completion.choices[0]?.message?.content || "";
        } catch (e) {
            console.error(`AI Error for ${name}:`, e);
        }

        // Build Swap Link
        const swapLink = `https://matcha.xyz/trade?chain=base&sellToken=ETH&buyToken=${base.address}&swapFeeRecipient=${REFERRAL_WALLET}&swapFeeBps=${SWAP_FEE_BPS}`;

        // Upsert
        const signal = {
            token_address: base.address,
            pair_address: pair.pairAddress,
            liquidity_eth: liq,
            initial_price: parseFloat(pair.priceUsd || 0),
            swap_link: swapLink,
            token_name: `${name} (${symbol})`,
            token_summary: summary,
            price_change_pct: change,
            volume_24h: vol,
            market_cap: parseFloat(pair.marketCap || pair.fdv || 0),
            dex_url: pair.url,
            updated_at: new Date().toISOString(),
        };

        const { error } = await supabase.from("signals").upsert(signal, { onConflict: "token_address" });
        if (error) console.error("Upsert Error:", error);

        finalResults.push({ name, change });
    }

    // 6. Cleanup
    await cleanupOldSignals();

    return NextResponse.json({ success: true, processed: finalResults.length, top: finalResults });
}

async function cleanupOldSignals() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await supabase.from("signals").delete().lt("updated_at", cutoff);
}
