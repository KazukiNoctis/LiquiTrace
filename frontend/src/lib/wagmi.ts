import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { injected, coinbaseWallet } from "wagmi/connectors";

export const wagmiConfig = createConfig({
    chains: [base],
    connectors: [
        farcasterMiniApp(),
        injected(),
        coinbaseWallet({ appName: "LiquiTrace" }),
    ],
    transports: {
        [base.id]: http(),
    },
});
