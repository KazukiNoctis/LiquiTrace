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
// Notification Sender
// --------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://liquitrace.vercel.app";

interface SignalSummary {
    name: string;
    change: number;
}

async function sendSignalNotifications(newSignals: SignalSummary[]) {
    if (newSignals.length === 0) return;

    try {
        // Fetch all subscribers
        const { data: subscribers, error } = await supabase
            .from("notification_subscribers")
            .select("token, notification_url");

        if (error || !subscribers || subscribers.length === 0) {
            if (error) console.error("[Notify] Fetch subs error:", error);
            return;
        }

        // Build notification content
        const topSignal = newSignals[0];
        const title = `🚀 ${topSignal.name} +${topSignal.change.toFixed(0)}%`;
        const body = newSignals.length > 1
            ? `and ${newSignals.length - 1} more signal${newSignals.length > 2 ? "s" : ""} detected on Base`
            : `New top gainer detected on Base`;
        const notificationId = `signal-${Date.now()}`;

        // Group tokens by notification_url
        const urlGroups = new Map<string, string[]>();
        for (const sub of subscribers) {
            const tokens = urlGroups.get(sub.notification_url) || [];
            tokens.push(sub.token);
            urlGroups.set(sub.notification_url, tokens);
        }

        // Send notifications (batch up to 100 tokens per request)
        for (const [url, tokens] of urlGroups) {
            for (let i = 0; i < tokens.length; i += 100) {
                const batch = tokens.slice(i, i + 100);

                try {
                    const res = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            notificationId,
                            title,
                            body,
                            targetUrl: APP_URL,
                            tokens: batch,
                        }),
                    });

                    if (res.ok) {
                        const result = await res.json();

                        // Clean up invalid tokens
                        const invalidTokens: string[] = result.invalidTokens || [];
                        if (invalidTokens.length > 0) {
                            await supabase
                                .from("notification_subscribers")
                                .delete()
                                .in("token", invalidTokens);
                            console.log(`[Notify] Cleaned ${invalidTokens.length} invalid tokens`);
                        }

                        const successCount = result.successfulTokens?.length || 0;
                        const rateLimited = result.rateLimitedTokens?.length || 0;
                        console.log(`[Notify] Sent: ${successCount} ok, ${rateLimited} rate-limited, ${invalidTokens.length} invalid`);
                    } else {
                        console.error(`[Notify] API error: ${res.status} ${res.statusText}`);
                    }
                } catch (err) {
                    console.error("[Notify] Send error:", err);
                }
            }
        }
    } catch (err) {
        console.error("[Notify] Unexpected error:", err);
    }
}

// --------------------------------------------------------------------------
// Main Scraper Function
// --------------------------------------------------------------------------

// Main Scraper Function
export async function runBotScan() {
    console.log("Starting Scan...");

    // 1. Fetch Data
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

    // 3. Filter & Sort
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

    if (candidates.length === 0) {
        await cleanupOldSignals();
        return { success: true, message: "No gainers found", count: 0 };
    }

    // 4. Process
    const results: SignalSummary[] = [];
    const newSignals: SignalSummary[] = [];

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

        const { error, data } = await supabase
            .from("signals")
            .upsert(signal, { onConflict: "token_address" })
            .select("id");

        if (error) {
            console.error("Upsert Error:", error);
        }

        const signalInfo = { name: `${name} (${symbol})`, change };
        results.push(signalInfo);

        // Track new signals (upsert returned data means it was inserted/updated)
        if (data && data.length > 0) {
            newSignals.push(signalInfo);
        }
    }

    // 5. Send notifications for new signals
    if (newSignals.length > 0) {
        await sendSignalNotifications(newSignals);
    }

    await cleanupOldSignals();
    return { success: true, processed: results.length, top: results, notified: newSignals.length };
}

