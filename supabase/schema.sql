-- ============================================
-- LiquiTrace – Supabase SQL Schema
-- Table: signals (Top Gainers on Base)
-- ============================================

CREATE TABLE IF NOT EXISTS signals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_address   TEXT        NOT NULL,
    pair_address    TEXT        NOT NULL UNIQUE,
    liquidity_eth   NUMERIC    NOT NULL DEFAULT 0,   -- stored as USD for top-gainers mode
    initial_price   NUMERIC    NOT NULL DEFAULT 0,
    swap_link       TEXT,
    token_name      TEXT        DEFAULT '',
    token_summary   TEXT        DEFAULT '',
    price_change_pct NUMERIC   DEFAULT 0,            -- 24h price change %
    volume_24h      NUMERIC    DEFAULT 0,            -- 24h trading volume USD
    market_cap      NUMERIC    DEFAULT 0,            -- market cap / FDV
    dex_url         TEXT        DEFAULT '',           -- DexScreener chart link
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast look-ups by token
CREATE INDEX IF NOT EXISTS idx_signals_token_address ON signals (token_address);

-- Index for filtering by liquidity
CREATE INDEX IF NOT EXISTS idx_signals_liquidity_eth ON signals (liquidity_eth);

-- Index for sorting by price change
CREATE INDEX IF NOT EXISTS idx_signals_price_change ON signals (price_change_pct DESC);

-- Enable Row Level Security (recommended for Supabase)
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to all signals
CREATE POLICY "Allow public read access" ON signals FOR SELECT USING (true);

-- ============================================
-- Migration: Add new columns if table exists
-- Run this if upgrading from the old schema.
-- ============================================
-- ALTER TABLE signals ADD COLUMN IF NOT EXISTS price_change_pct NUMERIC DEFAULT 0;
-- ALTER TABLE signals ADD COLUMN IF NOT EXISTS volume_24h NUMERIC DEFAULT 0;
-- ALTER TABLE signals ADD COLUMN IF NOT EXISTS market_cap NUMERIC DEFAULT 0;
-- ALTER TABLE signals ADD COLUMN IF NOT EXISTS dex_url TEXT DEFAULT '';
