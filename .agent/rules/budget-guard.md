---
trigger: always_on
---

# Budget & Efficiency Rules (Hemat)

## 1. Model & API Strategy
- **Model Choice:** Always use `gpt-4o-mini` for code generation and internal reasoning.
- **API Call Logic:** Never call the OpenAI API in a continuous loop. 
- **Signal Filtering (The Base App Standard):** Only trigger AI analysis if:
    - **Liquidity:** Must be > 1 ETH (No upper limit to match market leaders).
    - **Volume:** Must be > $1,000 (24h) to ensure organic activity and prevent "ghost" listings.
- **Polling:** Use `apscheduler` to poll DexScreener every 5 minutes.

## 2. Development & Code Style
- **Modularity:** Keep functions small. Do not rewrite existing code unless a bug is confirmed.
- **Minimalism:** Focus strictly on the "Top Gainer" spec.

## 3. Data Efficiency
- **Supabase Upsert:** Use `upsert` with `on_conflict="token_address"`.
- **48-Hour Retention:** Automatically delete any signal records older than 48 hours to stay within free-tier limits.