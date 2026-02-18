import { schedules } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

// Logic embedded to avoid import issues
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
// Scheduled Task Definition
// --------------------------------------------------------------------------

export const scanTarget = schedules.task({
    id: "scan-top-gainers",
    cron: "*/10 * * * *", // Run every 10 minutes
    maxDuration: 300, // 5 minutes max
    run: async (payload, { ctx }) => {

        // Environment Variables (Must be set in Trigger.dev Dashboard for Production)
        // For local dev, they are loaded from .env if running with CLI
        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const REFERRAL_WALLET = process.env.REFERRAL_WALLET || process.env.NEXT_PUBLIC_REFERRAL_WALLET;

        if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
            throw new Error("Missing Environment Variables (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY)");
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

        // --- Helpers ---
        // (Inlined helper functions)
        async function fetchBoostedTokens() {
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

        async function fetchSearchGainers() {
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

        async function fetchGeckoTrending() {
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

        async function fetchTokenPairs(addresses: string[]) {
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

        // --- Execution ---
        console.log("Starting Scan...");

        // 1. Fetch
        const [boostedAddrs, searchPairs, geckoPairs] = await Promise.all([
            fetchBoostedTokens(),
            fetchSearchGainers(),
            fetchGeckoTrending()
        ]);
        const boostedPairs = await fetchTokenPairs(boostedAddrs);

        // 2. Merge
        const allPairs = [...boostedPairs, ...searchPairs, ...geckoPairs];
        const uniquePairs = new Map<string, any>();

        for (const pair of allPairs) {
            const baseAddr = pair.baseToken?.address;
            if (!baseAddr) continue;
            if (!uniquePairs.has(baseAddr)) {
                uniquePairs.set(baseAddr, pair);
            }
        }

        // 3. Filter
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
            .sort((a, b) => b.change - a.change)
            .slice(0, TOP_N);

        // 4. Process
        const results = [];
        if (candidates.length > 0) {
            for (const { pair, change, vol, liq } of candidates) {
                const base = pair.baseToken;
                const name = base.name || "Unknown";
                const symbol = base.symbol || "???";

                // AI
                let summary = "";
                try {
                    const completion = await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [
                            { role: "system", content: "Analysis: ONE sentence description." },
                            { role: "user", content: `${name} (${symbol}) Change:${change}% Vol:$${vol}` }
                        ],
                        max_tokens: 120
                    });
                    summary = completion.choices[0]?.message?.content || "";
                } catch (e) {
                    console.error(`AI Error for ${name}:`, e);
                }

                const swapLink = `https://matcha.xyz/trade?chain=base&sellToken=ETH&buyToken=${base.address}&swapFeeRecipient=${REFERRAL_WALLET}&swapFeeBps=${SWAP_FEE_BPS}`;

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

                results.push({ name, change });
            }
        }

        await cleanupOldSignals();
        return { success: true, processed: results.length, top: results };
    },
});
