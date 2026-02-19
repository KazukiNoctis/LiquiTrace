"use client";

import { useEffect, useState } from "react";
import { type Context } from "@farcaster/miniapp-sdk";
import { useAccount, useConnect } from "wagmi";
import { sdk } from "@farcaster/miniapp-sdk";

export default function UserProfile() {
    const [farcasterUser, setFarcasterUser] = useState<Context.UserContext | null>(null);
    const { address, isConnected } = useAccount();
    const { connect, connectors } = useConnect();

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

    return (
        <button onClick={handleConnect} className="connect-btn">
            Connect Wallet
        </button>
    );
}
