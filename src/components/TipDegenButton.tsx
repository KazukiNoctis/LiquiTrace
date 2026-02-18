"use client";

import { useState, useEffect } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useConnect, useAccount } from "wagmi";
import { parseUnits } from "viem";

/** $DEGEN token on Base */
const DEGEN_ADDRESS = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" as const;

/** Minimal ERC-20 ABI – just transfer */
const ERC20_ABI = [
    {
        name: "transfer",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;

const TIP_AMOUNT = parseUnits("420", 18); // 420 $DEGEN

const REFERRAL_WALLET = (process.env.NEXT_PUBLIC_REFERRAL_WALLET ??
    "") as `0x${string}`;

export default function TipDegenButton() {
    const [mounted, setMounted] = useState(false);
    const { isConnected } = useAccount();
    const { connect, connectors } = useConnect();
    const { data: hash, writeContract, isPending, error } = useWriteContract();

    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
        hash,
    });

    useEffect(() => setMounted(true), []);

    const handleTip = () => {
        if (!isConnected) {
            const connector = connectors[0];
            if (connector) {
                connect({ connector });
            }
            return;
        }

        writeContract({
            address: DEGEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [REFERRAL_WALLET, TIP_AMOUNT],
        });
    };

    // Before mount, always show the same text as SSR to avoid hydration mismatch
    const label = !mounted
        ? "Tip 420 $DEGEN 🎩"
        : !isConnected
            ? "Connect & Tip 🎩"
            : isPending
                ? "Confirm in wallet…"
                : isConfirming
                    ? "Confirming…"
                    : isSuccess
                        ? "Tipped 420 $DEGEN ✅"
                        : "Tip 420 $DEGEN 🎩";

    return (
        <button
            onClick={handleTip}
            disabled={isPending || isConfirming}
            className="tip-degen-btn"
        >
            {label}
            {error && (
                <span className="tip-error">
                    {(error as Error).message?.slice(0, 40)}
                </span>
            )}
        </button>
    );
}
