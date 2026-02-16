"""
LiquiTrace – Top Gainers on Base (bot.py)

Polls DexScreener API every 5 minutes for the top-gaining tokens on Base,
enriches with GPT-4o-mini, generates a 0x/Matcha referral swap link,
and upserts to Supabase.

No RPC node required – uses free DexScreener REST API (300 req/min).

Designed to be called every 5 min by APScheduler from main.py.
"""

import logging
import requests

from openai import OpenAI
from supabase import create_client, Client as SupabaseClient

from config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    OPENAI_API_KEY,
    REFERRAL_WALLET,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEXSCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search"
DEXSCREENER_BOOSTS_URL = "https://api.dexscreener.com/token-boosts/top/v1"
DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/tokens/v1/base"
GECKOTERMINAL_TRENDING_URL = "https://api.geckoterminal.com/api/v2/networks/base/trending_pools"

CHAIN_ID = "base"
MIN_LIQUIDITY_USD = 2_500   # > 1 ETH (approx $2.5k) – no upper limit
MIN_VOLUME_24H = 1_000      # > $1K 24h volume
TOP_N = 10                  # keep top 10 gainers per scan

# 0x / Matcha referral swap link configuration
SWAP_FEE_BPS = 10  # 0.1 %

logger = logging.getLogger("liquitrace.bot")


# ---------------------------------------------------------------------------
# Clients / helpers
# ---------------------------------------------------------------------------

def get_supabase() -> SupabaseClient | None:
    """Return a Supabase client, or None if credentials are missing."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("Supabase credentials missing – signals will NOT be saved.")
        return None
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_openai() -> OpenAI | None:
    """Return an OpenAI client, or None if key is missing."""
    if not OPENAI_API_KEY:
        logger.warning("OpenAI API key missing – token summaries disabled.")
        return None
    return OpenAI(api_key=OPENAI_API_KEY)


# ---------------------------------------------------------------------------
# DexScreener API
# ---------------------------------------------------------------------------

def fetch_top_boosted_base_tokens() -> list[str]:
    """Fetch top boosted token addresses on Base from DexScreener."""
    try:
        resp = requests.get(DEXSCREENER_BOOSTS_URL, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.error("Failed to fetch boosted tokens: %s", exc)
        return []

    addresses = []
    for item in data:
        if item.get("chainId") == CHAIN_ID:
            addresses.append(item["tokenAddress"])
    logger.info("Found %d boosted Base tokens.", len(addresses))
    return addresses


def fetch_base_gainers() -> list[dict]:
    """
    Fetch trending/top pairs on Base using DexScreener search.
    We search several queries to maximise coverage, then deduplicate.
    """
    queries = [
        "WETH", "USDC",           # Core quote tokens (ensures tradeability)
        "trending", "base",       # General discovery
        "DEGEN", "BRETT", "TOSHI", "HIGHER",  # Popular Base ecosystem tokens
        "meme", "social", "AI",   # Category-based discovery
    ]
    seen_pairs: set[str] = set()
    all_pairs: list[dict] = []

    for q in queries:
        try:
            resp = requests.get(
                DEXSCREENER_SEARCH_URL,
                params={"q": q},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("DexScreener search '%s' failed: %s", q, exc)
            continue

        for pair in data.get("pairs", []):
            if pair.get("chainId") != CHAIN_ID:
                continue
            pair_addr = pair.get("pairAddress", "")
            if pair_addr in seen_pairs:
                continue
            seen_pairs.add(pair_addr)
            all_pairs.append(pair)

    logger.info("Fetched %d unique Base pairs from search.", len(all_pairs))
    return all_pairs


def fetch_gecko_trending() -> list[dict]:
    """
    Fetch trending pools on Base from GeckoTerminal and normalize
    them into DexScreener-compatible pair dicts.
    """
    try:
        resp = requests.get(
            GECKOTERMINAL_TRENDING_URL,
            headers={"Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("GeckoTerminal trending fetch failed: %s", exc)
        return []

    pairs: list[dict] = []
    for pool in data.get("data", []):
        attr = pool.get("attributes", {})
        rels = pool.get("relationships", {})

        # Extract base token address from relationship id ("base_0x...")
        base_token_id = (rels.get("base_token", {}).get("data", {}).get("id", ""))
        base_token_addr = base_token_id.replace("base_", "") if base_token_id.startswith("base_") else ""

        # Parse name: "BNKR / WETH 1%" -> name="BNKR", symbol="BNKR"
        pool_name = attr.get("name", "")
        token_name = pool_name.split(" / ")[0].strip() if " / " in pool_name else pool_name

        price_change = attr.get("price_change_percentage", {})
        volume = attr.get("volume_usd", {})

        # Normalize to DexScreener-compatible format
        normalized = {
            "chainId": CHAIN_ID,
            "pairAddress": attr.get("address", ""),
            "baseToken": {
                "address": base_token_addr,
                "name": token_name,
                "symbol": token_name,
            },
            "priceUsd": attr.get("base_token_price_usd", "0"),
            "priceChange": {
                "h24": float(price_change.get("h24", 0) or 0),
            },
            "liquidity": {
                "usd": float(attr.get("reserve_in_usd", 0) or 0),
            },
            "volume": {
                "h24": float(volume.get("h24", 0) or 0),
            },
            "marketCap": float(attr.get("market_cap_usd") or attr.get("fdv_usd") or 0),
            "fdv": float(attr.get("fdv_usd") or 0),
            "url": f"https://dexscreener.com/base/{base_token_addr}",
            "_source": "geckoterminal",
        }
        pairs.append(normalized)

    logger.info("Fetched %d trending Base pools from GeckoTerminal.", len(pairs))
    return pairs


def fetch_token_pairs(token_addresses: list[str]) -> list[dict]:
    """Fetch detailed pair data for a batch of token addresses on Base."""
    if not token_addresses:
        return []

    # DexScreener supports up to 30 comma-separated addresses
    batch = token_addresses[:30]
    addr_str = ",".join(batch)

    try:
        resp = requests.get(f"{DEXSCREENER_TOKENS_URL}/{addr_str}", timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.error("Failed to fetch token pairs: %s", exc)
        return []

    pairs = data if isinstance(data, list) else data.get("pairs", [])
    logger.info("Fetched %d pairs for %d boosted tokens.", len(pairs), len(batch))
    return pairs


def select_top_gainers(pairs: list[dict]) -> list[dict]:
    """
    Filter and sort pairs to find the top gainers.

    Filters:
    - Base chain only
    - Liquidity ≥ MIN_LIQUIDITY_USD
    - 24h volume ≥ MIN_VOLUME_24H
    - Has positive 24h price change

    Sorts by 24h price change descending, returns top N.
    """
    candidates = []
    for pair in pairs:
        if pair.get("chainId") != CHAIN_ID:
            continue

        liquidity_usd = (pair.get("liquidity") or {}).get("usd", 0) or 0
        volume_24h = (pair.get("volume") or {}).get("h24", 0) or 0
        price_change_24h = (pair.get("priceChange") or {}).get("h24")

        if liquidity_usd < MIN_LIQUIDITY_USD:
            continue
        if volume_24h < MIN_VOLUME_24H:
            continue
        if price_change_24h is None:
            continue

        candidates.append({
            "pair": pair,
            "price_change_24h": float(price_change_24h),
            "liquidity_usd": float(liquidity_usd),
            "volume_24h": float(volume_24h),
        })

    # Sort by 24h price change descending (biggest gainers first)
    candidates.sort(key=lambda x: x["price_change_24h"], reverse=True)
    top = candidates[:TOP_N]

    logger.info(
        "Selected %d top gainers from %d candidates (of %d total pairs).",
        len(top), len(candidates), len(pairs),
    )
    return top


# ---------------------------------------------------------------------------
# GPT enrichment (gpt-4o-mini only, per budget-guard rules)
# ---------------------------------------------------------------------------

def summarise_token(
    client: OpenAI, token_name: str, token_symbol: str,
    price_change: float, volume_24h: float,
) -> str:
    """Ask gpt-4o-mini for a one-sentence summary of the token."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=120,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a concise crypto analyst. "
                    "Given a token name, symbol, 24h price change %, and 24h volume, "
                    "write ONE sentence describing the token and its current momentum."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Token: {token_name} ({token_symbol})\n"
                    f"24h Price Change: {price_change:+.1f}%\n"
                    f"24h Volume: ${volume_24h:,.0f}"
                ),
            },
        ],
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Swap link builder
# ---------------------------------------------------------------------------

def build_swap_link(token_address: str) -> str:
    """Build a Matcha / 0x v2 referral swap URL."""
    base_url = "https://matcha.xyz/trade"
    return (
        f"{base_url}"
        f"?chain=base"
        f"&sellToken=ETH"
        f"&buyToken={token_address}"
        f"&swapFeeRecipient={REFERRAL_WALLET}"
        f"&swapFeeBps={SWAP_FEE_BPS}"
    )


# ---------------------------------------------------------------------------
# Supabase persistence (upsert to avoid duplicates)
# ---------------------------------------------------------------------------

def save_signal(sb: SupabaseClient, signal: dict) -> None:
    """Upsert a signal into the Supabase `signals` table."""
    row = {
        "token_address": signal["token_address"],
        "pair_address": signal["pair_address"],
        "liquidity_eth": signal["liquidity_usd"],
        "initial_price": signal.get("price_usd", 0),
        "swap_link": signal["swap_link"],
        "token_name": signal.get("token_name", ""),
        "token_summary": signal.get("token_summary", ""),
        "price_change_pct": signal.get("price_change_24h", 0),
        "volume_24h": signal.get("volume_24h", 0),
        "market_cap": signal.get("market_cap", 0),
        "dex_url": signal.get("dex_url", ""),
        "updated_at": "now()",  # Force update timestamp on every upsert
    }
    # Upsert on token_address to prevent duplicate tokens
    sb.table("signals").upsert(row, on_conflict="token_address").execute()
    logger.info("Saved signal: %s", signal["token_name"])


def cleanup_old_signals(sb: SupabaseClient) -> None:
    """Delete signals that haven't been updated in 48 hours."""
    try:
        # 'lt' = less than. We use a relative interval string for Postgres if possible,
        # but Supabase client filter expects a flexible value.
        # Simplest is to let Postgres calculate 'now() - interval 48 hours'.
        # However, supabase-py text search might be tricky with raw SQL.
        # We'll use the rpc or just a raw standard filter if we calculate python side.
        # Let's calculate the cutoff time in Python to be safe and DB-agnostic.
        
        import datetime
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=48)
        cutoff_str = cutoff.isoformat()

        res = sb.table("signals").delete().lt("updated_at", cutoff_str).execute()
        # Count is equivalent to len(res.data) if return body is representation
        if res.data:
            logger.info("Cleaned up %d old signals (>48h).", len(res.data))
    except Exception as exc:
        logger.error("Cleanup failed: %s", exc)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def scan_top_gainers() -> None:
    """
    Main scan routine – called every 5 min by APScheduler.

    1. Fetch boosted Base tokens from DexScreener.
    2. Fetch detailed pair data for boosted tokens.
    3. Fetch trending Base pairs from DexScreener search.
    3b. Fetch trending Base pools from GeckoTerminal.
    4. Merge all sources, deduplicate by token address.
    5. Filter by liquidity/volume, sort by 24h gain, take top 10.
    6. Enrich each with GPT-4o-mini summary.
    7. Build 0x referral swap link.
    8. Upsert to Supabase.
    9. Cleanup old signals.
    """
    sb = get_supabase()
    ai = get_openai()

    # ... [Fetch & Process logic unchanged] ...

    # --- 1. Get boosted token addresses on Base ---
    boosted_addresses = fetch_top_boosted_base_tokens()

    # --- 2. Get pair data for boosted tokens ---
    boosted_pairs = fetch_token_pairs(boosted_addresses)

    # --- 3. Get trending pairs via DexScreener search ---
    search_pairs = fetch_base_gainers()

    # --- 3b. Get trending pairs via GeckoTerminal ---
    gecko_pairs = fetch_gecko_trending()

    # --- 4. Merge all pairs (deduplicate by baseToken address) ---
    seen: set[str] = set()
    all_pairs: list[dict] = []
    for pair in boosted_pairs + search_pairs + gecko_pairs:
        # Deduplicate by base token address (not pair address)
        base_addr = (pair.get("baseToken") or {}).get("address", "")
        if not base_addr or base_addr in seen:
            continue
        seen.add(base_addr)
        all_pairs.append(pair)

    logger.info("Total unique pairs to evaluate: %d", len(all_pairs))

    # --- 5. Select top gainers ---
    gainers = select_top_gainers(all_pairs)

    if not gainers:
        logger.info("No gainers passed filters this scan.")
        # Even if no new gainers, disable cleanup? No, always cleanup.
        if sb:
            cleanup_old_signals(sb)
        return

    # --- 6-8. Process each gainer ---
    for entry in gainers:
        pair = entry["pair"]
        base_token = pair.get("baseToken", {})
        token_address = base_token.get("address", "")
        token_name = base_token.get("name", "Unknown")
        token_symbol = base_token.get("symbol", "???")
        price_usd = float(pair.get("priceUsd") or 0)
        display_name = f"{token_name} ({token_symbol})"

        logger.info(
            "🚀 %s  |  24h: %+.1f%%  |  Vol: $%.0f  |  Liq: $%.0f",
            display_name,
            entry["price_change_24h"],
            entry["volume_24h"],
            entry["liquidity_usd"],
        )

        # ----- GPT summary (single call per token, not in a loop) -----
        token_summary = ""
        if ai:
            try:
                token_summary = summarise_token(
                    ai, token_name, token_symbol,
                    entry["price_change_24h"], entry["volume_24h"],
                )
                logger.info("  GPT: %s", token_summary)
            except Exception as exc:
                logger.error("  GPT call failed: %s", exc)

        # ----- Swap link -----
        swap_link = build_swap_link(token_address)

        # ----- Save -----
        signal = {
            "token_address": token_address,
            "pair_address": pair.get("pairAddress", ""),
            "liquidity_usd": entry["liquidity_usd"],
            "price_usd": price_usd,
            "swap_link": swap_link,
            "token_name": display_name,
            "token_summary": token_summary,
            "price_change_24h": entry["price_change_24h"],
            "volume_24h": entry["volume_24h"],
            "market_cap": float(pair.get("marketCap") or pair.get("fdv") or 0),
            "dex_url": pair.get("url", ""),
        }

        if sb:
            try:
                save_signal(sb, signal)
            except Exception as exc:
                logger.error("Supabase save failed: %s", exc)
        else:
            logger.info("Signal (not saved): %s", signal)

    # --- 9. Cleanup old signals ---
    if sb:
        cleanup_old_signals(sb)

    logger.info("Scan complete. Saved %d top gainer(s).", len(gainers))


# Keep legacy name for APScheduler compatibility
scan_new_pairs = scan_top_gainers


# ---------------------------------------------------------------------------
# Standalone dry-run (for testing)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-22s  %(levelname)-7s  %(message)s",
    )
    print("🔎 LiquiTrace – Top Gainers dry-run scan …")
    scan_top_gainers()
    print("✅ Done.")
