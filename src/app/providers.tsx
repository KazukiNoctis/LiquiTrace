"use client";

import { useEffect, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sdk } from "@farcaster/miniapp-sdk";
import { wagmiConfig } from "@/lib/wagmi";

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
    useEffect(() => {
        // Dismiss the Farcaster splash screen once the app mounts
        sdk.actions.ready().catch(() => {
            // Silently ignore if not running inside Farcaster client
        });
    }, []);

    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
    );
}
