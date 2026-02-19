"use client";

import { useEffect, useState } from "react";
import { type Context } from "@farcaster/miniapp-sdk";
import { useAccount, useConnect } from "wagmi";
import { sdk } from "@farcaster/miniapp-sdk";

export default function UserProfile() {
    const [farcasterUser, setFarcasterUser] = useState<Context.UserContext | null>(null);
    const { address, isConnected } = useAccount();
    const { connect, connectors } = useConnect();
    const [mounted, setMounted] = useState(false);
    const [showOptions, setShowOptions] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

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

    const handleConnect = () => {
        const connector = connectors[0];
        if (connector) {
            connect({ connector });
        }
    };

    if (farcasterUser) {
        return (
            <div className="user-profile">
                <img
                    src={farcasterUser.pfpUrl}
                    alt={farcasterUser.username}
                    className="user-avatar"
                />
                <span className="user-name">@{farcasterUser.username}</span>
            </div>
        );
    }

    if (isConnected && address) {
        return (
            <div className="user-profile wallet-mode">
                <div className="wallet-avatar-placeholder" />
                <span className="user-name">
                    {address.slice(0, 6)}…{address.slice(-4)}
                </span>
            </div>
        );
    }



    if (!mounted) return null;

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
