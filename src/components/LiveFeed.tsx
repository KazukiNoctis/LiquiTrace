"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import SwapModal from "./SwapModal";

interface Signal {
    id: number;
    token_address: string;
    pair_address: string;
    liquidity_eth: number;
    initial_price: number;
    swap_link: string;
    token_name: string;
    token_summary: string;
    price_change_pct: number;
    volume_24h: number;
    market_cap: number;
    dex_url: string;
    created_at: string;
    updated_at: string;
}

export default function LiveFeed() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

    // Force re-render periodically to update relative freshness
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 60000); // Check every minute
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const supabase = getSupabase();

        const fetchSignals = async () => {
            const { data, error } = await supabase
                .from("signals")
                .select("*")
                .order("updated_at", { ascending: false })
                .limit(50);

            if (error) {
                console.error("Error fetching signals:", error);
            } else if (data) {
                setSignals(data as Signal[]);
            }
            setIsLoading(false);
        };

        fetchSignals();

        // Subscribe to realtime INSERT and UPDATE events
        const channel = supabase
            .channel("signals-realtime")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "signals" },
                (payload: { new: Record<string, unknown>, eventType: string }) => {
                    const newSignal = payload.new as unknown as Signal;

                    setSignals((prev) => {
                        // Remove existing copy if updated to bring it to top
                        const filtered = prev.filter(s => s.id !== newSignal.id && s.token_address !== newSignal.token_address);
                        return [newSignal, ...filtered];
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const formatCompact = (n: number): string => {
        if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
        return `$${n.toFixed(0)}`;
    };

    const truncateAddress = (addr: string) =>
        addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";

    const getTokenSymbol = (name: string) => {
        const match = name.match(/\(([^)]+)\)$/);
        return match ? match[1] : "TOKEN";
    };

    const isFresh = (updatedAt: string) => {
        if (!updatedAt) return false;
        const now = Date.now();
        const updated = new Date(updatedAt).getTime();
        return (now - updated) < 5 * 60 * 1000; // 5 minutes
    };

    if (isLoading) {
        return (
            <div className="feed-loading">
                <div className="pulse-dot" />
                <span>Loading top gainers…</span>
            </div>
        );
    }

    if (signals.length === 0) {
        return (
            <div className="feed-empty">
                <div className="empty-icon">🚀</div>
                <h3>No gainers yet</h3>
                <p>
                    The bot scans DexScreener every 5 minutes for top-gaining
                    tokens on Base. Results will appear here in real-time.
                </p>
                <div style={{ fontSize: "12px", marginTop: "1rem", color: "#666" }}>
                    (Check browser console if this persists)
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="feed-grid">
                {signals.map((signal, idx) => {
                    const pctChange = Number(signal.price_change_pct) || 0;
                    const isPositive = pctChange >= 0;
                    const fresh = isFresh(signal.updated_at);

                    return (
                        <div
                            key={signal.id ?? idx}
                            className={`signal-card ${fresh ? (isPositive ? "glow-fresh" : "glow-new") : ""}`}
                            style={{ animationDelay: `${idx * 60}ms` }}
                        >
                            {/* Header row */}
                            <div className="card-header">
                                <span className="token-name">
                                    {signal.token_name || truncateAddress(signal.token_address)}
                                    {fresh && <span className="fresh-dot" title="Just updated" />}
                                </span>
                                <span
                                    className={`price-badge ${isPositive ? "price-up" : "price-down"}`}
                                >
                                    {isPositive ? "▲" : "▼"} {Math.abs(pctChange).toFixed(1)}%
                                </span>
                            </div>

                            {/* Stats row */}
                            <div className="card-stats">
                                <div className="stat">
                                    <span className="stat-label">Volume 24h</span>
                                    <span className="stat-value">
                                        {formatCompact(Number(signal.volume_24h) || 0)}
                                    </span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">Liquidity</span>
                                    <span className="stat-value">
                                        {formatCompact(Number(signal.liquidity_eth) || 0)}
                                    </span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">MCap</span>
                                    <span className="stat-value">
                                        {formatCompact(Number(signal.market_cap) || 0)}
                                    </span>
                                </div>
                            </div>

                            {/* Summary */}
                            {signal.token_summary && (
                                <p className="card-summary">{signal.token_summary}</p>
                            )}

                            {/* Address */}
                            <div className="card-address">
                                <span>{truncateAddress(signal.token_address)}</span>
                            </div>

                            {/* Actions */}
                            <div className="card-actions">
                                <button
                                    onClick={() => setSelectedSignal(signal)}
                                    className="swap-btn"
                                >
                                    Swap ⚡
                                </button>
                                {signal.dex_url && (
                                    <a
                                        href={signal.dex_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="chart-btn"
                                    >
                                        📈 Chart
                                    </a>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* In-App Swap Modal */}
            <SwapModal
                isOpen={!!selectedSignal}
                onClose={() => setSelectedSignal(null)}
                tokenAddress={selectedSignal?.token_address || ""}
                tokenSymbol={getTokenSymbol(selectedSignal?.token_name || "")}
                tokenName={selectedSignal?.token_name || ""}
            />
        </>
    );
}
