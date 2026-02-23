"use client";

import { useEffect, useState } from "react";
import { type Context } from "@farcaster/miniapp-sdk";
import { useAccount, useConnect, useBalance, useReadContract } from "wagmi";
import { sdk } from "@farcaster/miniapp-sdk";
import { formatUnits, erc20Abi } from "viem";

const CHAIN_ID = 8453;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default function UserProfile() {
    const [farcasterUser, setFarcasterUser] = useState<Context.UserContext | null>(null);
    const { address, isConnected } = useAccount();
    const { connect, connectors } = useConnect();
    const [mounted, setMounted] = useState(false);
    const [showOptions, setShowOptions] = useState(false);
    const [showAssets, setShowAssets] = useState(false);

    // ETH balance
    const { data: ethBalance, isLoading: isEthLoading, refetch: refetchEth } = useBalance({
        address,
        chainId: CHAIN_ID,
        query: { enabled: !!address },
    });

    // USDC balance
    const { data: usdcRaw, isLoading: isUsdcLoading, refetch: refetchUsdc } = useReadContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
        chainId: CHAIN_ID,
        query: { enabled: !!address },
    });

    const ethDisplay = ethBalance ? parseFloat(formatUnits(ethBalance.value, 18)).toFixed(6) : "0.000000";
    const usdcDisplay = usdcRaw !== undefined ? parseFloat(formatUnits(usdcRaw as bigint, 6)).toFixed(2) : "0.00";

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const loadContext = async () => {
            try {
                const context = await sdk.context;
                if (context?.user) {
                    setFarcasterUser(context.user);
                }
            } catch (err) {
                console.error("Failed to load Farcaster context:", err);
            }
        };
        loadContext();
    }, []);

    // Close asset panel when clicking outside
    useEffect(() => {
        if (!showAssets) return;
        const handleClick = () => setShowAssets(false);
        const t = setTimeout(() => document.addEventListener("click", handleClick), 10);
        return () => { clearTimeout(t); document.removeEventListener("click", handleClick); };
    }, [showAssets]);

    if (!mounted) return null;

    const handleConnect = () => {
        const connector = connectors[0];
        if (connector) {
            connect({ connector });
        }
    };

    const handleRefresh = (e: React.MouseEvent) => {
        e.stopPropagation();
        refetchEth();
        refetchUsdc();
    };

    const profilePill = (avatar: React.ReactNode, label: string) => (
        <div className="profile-wrapper">
            <div
                className="user-profile"
                onClick={(e) => { e.stopPropagation(); setShowAssets(!showAssets); }}
                style={{ cursor: "pointer" }}
            >
                {avatar}
                <span className="user-name">{label}</span>
                <span className="asset-chevron">{showAssets ? "▲" : "▼"}</span>
            </div>

            {showAssets && (
                <div className="asset-panel" onClick={(e) => e.stopPropagation()}>
                    <div className="asset-panel-header">
                        <span>My Assets</span>
                        <button className="asset-refresh" onClick={handleRefresh}>&#8635;</button>
                    </div>
                    <div className="asset-row">
                        <div className="asset-icon">Ξ</div>
                        <div className="asset-info">
                            <span className="asset-symbol">ETH</span>
                            <span className="asset-balance">{isEthLoading ? "..." : ethDisplay}</span>
                        </div>
                    </div>
                    <div className="asset-row">
                        <div className="asset-icon usdc">$</div>
                        <div className="asset-info">
                            <span className="asset-symbol">USDC</span>
                            <span className="asset-balance">{isUsdcLoading ? "..." : usdcDisplay}</span>
                        </div>
                    </div>
                    {address && (
                        <a
                            href={`https://basescan.org/address/${address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="asset-basescan"
                        >
                            View on BaseScan ↗
                        </a>
                    )}
                </div>
            )}
        </div>
    );

    if (farcasterUser) {
        return profilePill(
            <img src={farcasterUser.pfpUrl} alt={farcasterUser.username} className="user-avatar" />,
            `@${farcasterUser.username}`
        );
    }

    if (isConnected && address) {
        return profilePill(
            <div className="wallet-avatar-placeholder" />,
            `${address.slice(0, 6)}…${address.slice(-4)}`
        );
    }





    return (
        <div className="relative">
            {!showOptions ? (
                <button
                    onClick={() => setShowOptions(true)}
                    className="connect-btn"
                >
                    Connect Wallet
                </button>
            ) : (
                <div className="wallet-dropdown">
                    <div className="dropdown-header">
                        <span>Select Wallet</span>
                        <button onClick={() => setShowOptions(false)} className="close-dropdown">&times;</button>
                    </div>
                    <div className="dropdown-list">
                        {connectors.map((connector) => (
                            <button
                                key={connector.uid}
                                onClick={() => {
                                    connect({ connector });
                                    setShowOptions(false);
                                }}
                                className="connector-option"
                            >
                                {connector.name === "Farcaster Mini App" ? "Farcaster" : connector.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <style jsx>{`
                .relative {
                    position: relative;
                }
                .wallet-dropdown {
                    position: absolute;
                    top: 100%;
                    right: 0;
                    margin-top: 8px;
                    background: #1a1a2e;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 8px;
                    width: 200px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    z-index: 50;
                    animation: fadeIn 0.1s ease;
                }
                .dropdown-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0 8px 8px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    margin-bottom: 4px;
                    font-size: 12px;
                    color: #888;
                    font-weight: 600;
                }
                .close-dropdown {
                    background: none;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    font-size: 16px;
                }
                .dropdown-list {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .connector-option {
                    text-align: left;
                    padding: 8px 12px;
                    background: rgba(255, 255, 255, 0.03);
                    border: none;
                    border-radius: 8px;
                    color: #eee;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .connector-option:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #00ffaa;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
