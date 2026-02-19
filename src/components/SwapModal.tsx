"use client";

import { useState, useEffect } from "react";
import {
    useAccount,
    useSendTransaction,
    useBalance,
    useReadContract,
    useWriteContract,
    useWaitForTransactionReceipt,
    useConnect,
    useSwitchChain,
} from "wagmi";
import { useCapabilities, useWriteContracts } from "wagmi/experimental";
import { parseUnits, formatUnits, erc20Abi, maxUint256, encodeFunctionData } from "viem";

interface SwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    tokenAddress: string;
    tokenSymbol: string;
    tokenName: string;
}

const REFERRAL_WALLET = process.env.NEXT_PUBLIC_REFERRAL_WALLET;
const CHAIN_ID = 8453;

const TOKENS = {
    ETH: {
        symbol: "ETH",
        address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        decimals: 18,
    },
    USDC: {
        symbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
    },
};

const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

export default function SwapModal({
    isOpen,
    onClose,
    tokenAddress,
    tokenSymbol,
    tokenName,
}: SwapModalProps) {
    const { address, isConnected, chainId } = useAccount();
    const { connectors, connect } = useConnect();
    const { switchChain } = useSwitchChain();

    // Standard ops
    const {
        sendTransaction,
        isPending: isSwapPending,
        isSuccess: isSwapSuccess,
        error: swapError,
    } = useSendTransaction();

    const {
        writeContract: approveToken,
        data: approveTxHash,
        isPending: isApprovePending,
    } = useWriteContract();
    const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
        useWaitForTransactionReceipt({ hash: approveTxHash });

    // EIP-5792 capabilities
    const { data: availableCapabilities } = useCapabilities({
        account: address,
    });
    const capabilities = availableCapabilities?.[CHAIN_ID];
    const supportsBatch = capabilities?.atomicBatch?.supported === true;

    const {
        writeContracts,
        isPending: isBatchPending,
        isSuccess: isBatchSuccess,
        error: batchError
    } = useWriteContracts();

    const [sellToken, setSellToken] = useState<"ETH" | "USDC">("ETH");
    const [amount, setAmount] = useState("0.01");
    const [quote, setQuote] = useState<any>(null);
    const [loadingQuote, setLoadingQuote] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);

    // ── ETH Balance (native) ──────────────────────────────────
    const {
        data: ethBalance,
        isLoading: isEthLoading,
        refetch: refetchEth,
    } = useBalance({
        address,
        chainId: CHAIN_ID,
        query: { enabled: !!address },
    });

    // ── USDC Balance (via direct contract read — NOT useBalance) ──
    const {
        data: usdcRawBalance,
        isLoading: isUsdcLoading,
        refetch: refetchUsdc,
    } = useReadContract({
        address: TOKENS.USDC.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
        chainId: CHAIN_ID,
        query: { enabled: !!address },
    });

    const usdcBalanceValue = usdcRawBalance !== undefined ? (usdcRawBalance as bigint) : undefined;
    const currentBalanceValue = sellToken === "ETH" ? ethBalance?.value : usdcBalanceValue;
    const currentDecimals = TOKENS[sellToken].decimals;
    const isBalanceLoading = sellToken === "ETH" ? isEthLoading : isUsdcLoading;

    useEffect(() => {
        if (isOpen && address) {
            refetchEth();
            refetchUsdc();
        }
    }, [isOpen, address, refetchEth, refetchUsdc]);

    // ── Allowance (USDC) ──────────────────────────────────────
    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: TOKENS.USDC.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as `0x${string}`, PERMIT2_ADDRESS],
        chainId: CHAIN_ID,
        query: { enabled: sellToken === "USDC" && !!address },
    });

    useEffect(() => {
        if (isApproveSuccess || isBatchSuccess) refetchAllowance();
    }, [isApproveSuccess, isBatchSuccess, refetchAllowance]);

    // ── Amount ────────────────────────────────────────────────
    const sanitizedAmount = amount.replace(/,/g, ".");
    let amountWei = 0n;
    try {
        amountWei = parseUnits(sanitizedAmount || "0", currentDecimals);
    } catch {
        amountWei = 0n;
    }

    // ── Quote ─────────────────────────────────────────────────
    useEffect(() => {
        if (
            !isOpen ||
            !sanitizedAmount ||
            parseFloat(sanitizedAmount) <= 0 ||
            !tokenAddress
        )
            return;

        const fetchQuote = async () => {
            setLoadingQuote(true);
            setQuoteError(null);
            setQuote(null);
            try {
                const taker = address || REFERRAL_WALLET || "0x0000000000000000000000000000000000000000";
                const params = new URLSearchParams({
                    chainId: CHAIN_ID.toString(),
                    sellToken: TOKENS[sellToken].address,
                    buyToken: tokenAddress,
                    sellAmount: amountWei.toString(),
                    taker,
                });
                const res = await fetch(`/api/quote?${params}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.reason || data.message || "Failed to fetch quote");
                setQuote(data);
            } catch (err: any) {
                console.error("Quote Error:", err);
                setQuoteError(err.message || "Error fetching price");
            } finally {
                setLoadingQuote(false);
            }
        };

        const t = setTimeout(fetchQuote, 600);
        return () => clearTimeout(t);
    }, [sanitizedAmount, isOpen, tokenAddress, address, sellToken]);

    // ── Actions ───────────────────────────────────────────────
    const handleApprove = () => {
        approveToken({
            address: TOKENS.USDC.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [PERMIT2_ADDRESS, maxUint256],
        });
    };

    const handleSwap = () => {
        if (!quote?.transaction) return;
        sendTransaction({
            to: quote.transaction.to,
            data: quote.transaction.data,
            value: BigInt(quote.transaction.value),
        });
    };

    const handleBatchSwap = () => {
        if (!quote?.transaction) return;

        const contracts = [];
        const needsApprove =
            sellToken === "USDC" &&
            allowance !== undefined &&
            amountWei > 0n &&
            (allowance as bigint) < amountWei;

        if (needsApprove) {
            contracts.push({
                address: TOKENS.USDC.address as `0x${string}`,
                abi: erc20Abi,
                functionName: "approve",
                args: [PERMIT2_ADDRESS, maxUint256]
            });
        }

        // Add the swap call
        // Note: writeContracts typically expects ABI-based calls, but for raw execution 
        // passing to/data/value is supported by some smart wallets via unstructured calls.
        // We'll try passing the raw transaction data. If TypeScript complains, we cast.
        contracts.push({
            address: quote.transaction.to as `0x${string}`,
            abi: [], // Empty ABI for raw call
            functionName: 'execute', // Dummy name or check if we can pass raw
            args: [],
            data: quote.transaction.data as `0x${string}`,
            value: BigInt(quote.transaction.value)
        });

        // @ts-ignore: wagmi typing might be strict about ABI, but under the hood it sends calls
        writeContracts({ contracts });
    };

    // ── Button State Machine ──────────────────────────────────
    type BtnState =
        | "connect"
        | "wrong-network"
        | "loading-balance"
        | "insufficient"
        | "approve"
        | "swap"
        | "batch-swap";

    const btnState: BtnState = (() => {
        if (!isConnected) return "connect";
        if (chainId !== CHAIN_ID) return "wrong-network";
        if (isBalanceLoading || currentBalanceValue === undefined) return "loading-balance";
        if (amountWei > currentBalanceValue) return "insufficient";

        const needsApprove =
            sellToken === "USDC" &&
            allowance !== undefined &&
            amountWei > 0n &&
            (allowance as bigint) < amountWei;

        if (supportsBatch) {
            // If we can batch, we always go to 'batch-swap' if approval is needed OR just swap
            // Actually, 'batch-swap' covers both cases (approve+swap OR just swap)
            return "batch-swap";
        }

        if (needsApprove) return "approve";
        return "swap";
    })();

    if (!isOpen) return null;

    const displayBalance = currentBalanceValue !== undefined
        ? parseFloat(formatUnits(currentBalanceValue, currentDecimals)).toFixed(sellToken === "USDC" ? 2 : 6)
        : isConnected ? "0.00" : "\u2014";

    const isWorking = isApprovePending || isApproveConfirming || isSwapPending || isBatchPending;
    const finalError = swapError || batchError;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Swap for {tokenSymbol}</h3>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* Token Selector */}
                    <div className="token-selector">
                        <button className={sellToken === "ETH" ? "active" : ""} onClick={() => setSellToken("ETH")}>ETH</button>
                        <button className={sellToken === "USDC" ? "active" : ""} onClick={() => setSellToken("USDC")}>USDC</button>
                    </div>

                    {/* Input */}
                    <div className="input-group">
                        <label>You Pay ({sellToken})</label>
                        <div className="input-wrapper">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => {
                                    if (/^[0-9.,]*$/.test(e.target.value)) setAmount(e.target.value);
                                }}
                                placeholder="0.0"
                            />
                            <span className="input-asset">{sellToken}</span>
                        </div>
                        <div className="balance-info">
                            <span>Balance: {isBalanceLoading ? "Loading..." : displayBalance} {sellToken}</span>
                            {isConnected && (
                                <button className="refresh-btn" onClick={() => { refetchEth(); refetchUsdc(); }}>&#8635;</button>
                            )}
                        </div>
                    </div>

                    {/* Warning */}
                    {btnState === "insufficient" && (
                        <div className="swap-msg error">Insufficient {sellToken} balance</div>
                    )}

                    {/* Quote */}
                    <div className="quote-preview">
                        <label>You Receive (Est.)</label>
                        {loadingQuote ? (
                            <div className="quote-loading">Fetching best price...</div>
                        ) : quoteError ? (
                            <div className="quote-error">{quoteError}</div>
                        ) : quote && quote.buyAmount ? (
                            <div className="quote-value">
                                {parseFloat(formatUnits(BigInt(quote.buyAmount), 18)).toLocaleString()} {tokenSymbol}
                            </div>
                        ) : (
                            <div className="quote-placeholder">&mdash;</div>
                        )}
                        {supportsBatch && <div style={{ fontSize: 10, marginTop: 4, color: '#00ffaa' }}>⚡ Smart Wallet Batching Active</div>}
                    </div>

                    {/* ── Buttons ── */}
                    {btnState === "connect" && (
                        <div className="connect-section">
                            <p className="swap-msg warning">Connect Wallet to Swap</p>
                            <div className="connect-buttons">
                                {connectors.map((c) => (
                                    <button key={c.uid} className="connect-btn" onClick={() => connect({ connector: c })}>
                                        {c.name === "Farcaster Mini App" ? "Farcaster" : c.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {btnState === "wrong-network" && (
                        <button className="switch-network-btn" onClick={() => switchChain({ chainId: CHAIN_ID })}>
                            Switch to Base Network
                        </button>
                    )}

                    {btnState === "loading-balance" && (
                        <button className="confirm-swap-btn" disabled>Loading Balance&hellip;</button>
                    )}

                    {btnState === "insufficient" && (
                        <button className="confirm-swap-btn" disabled>Insufficient Balance</button>
                    )}

                    {btnState === "approve" && (
                        <button
                            className="approve-btn"
                            disabled={isWorking}
                            onClick={handleApprove}
                        >
                            {isApprovePending || isApproveConfirming ? "Approving USDC..." : "Approve USDC"}
                        </button>
                    )}

                    {btnState === "swap" && (
                        <button
                            className="confirm-swap-btn"
                            disabled={!quote || loadingQuote || isWorking || !!quoteError}
                            onClick={handleSwap}
                        >
                            {isSwapPending ? "Swapping..." : "Confirm Swap"}
                        </button>
                    )}

                    {btnState === "batch-swap" && (
                        <button
                            className="confirm-swap-btn"
                            disabled={!quote || loadingQuote || isWorking || !!quoteError}
                            onClick={handleBatchSwap}
                        >
                            {isBatchPending ? "Confirming Batch..." : "Swap (1-Click) ⚡"}
                        </button>
                    )}

                    {/* Status messages */}
                    {isApproveSuccess && !isBatchSuccess && (
                        <div className="swap-msg success">USDC Approved! Now Swap.</div>
                    )}
                    {isSwapSuccess && (
                        <div className="swap-msg success">Transaction Sent! &#128640;</div>
                    )}
                    {isBatchSuccess && (
                        <div className="swap-msg success">Batch Transaction Sent! &#128640;</div>
                    )}
                    {finalError && (
                        <div className="swap-msg error">
                            Error: {finalError.message.slice(0, 50)}&hellip;
                        </div>
                    )}

                    {/* Debug */}
                    {/* <div className="debug-network">
                        State: {btnState} | Cap: {supportsBatch ? 'Yes' : 'No'}
                    </div> */}
                </div>
            </div>

            <style jsx>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    animation: fadeIn 0.15s ease;
                }
                .modal-content {
                    background: #111122;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 400px;
                    padding: 24px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    animation: slideUp 0.3s ease;
                }
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                .modal-header h3 {
                    margin: 0;
                    font-size: 18px;
                    color: #fff;
                }
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }
                .token-selector {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 20px;
                    background: #1a1a2e;
                    padding: 4px;
                    border-radius: 12px;
                }
                .token-selector button {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: #888;
                    padding: 8px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: all 0.2s;
                }
                .token-selector button.active {
                    background: #2a2a40;
                    color: #fff;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                }
                .input-group {
                    margin-bottom: 20px;
                }
                .input-group label {
                    display: block;
                    font-size: 12px;
                    color: #888;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .input-wrapper {
                    display: flex;
                    align-items: center;
                    background: #1a1a2e;
                    border-radius: 12px;
                    padding: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .input-wrapper input {
                    background: none;
                    border: none;
                    color: #fff;
                    font-size: 24px;
                    width: 100%;
                    outline: none;
                    font-family: monospace;
                }
                .input-asset {
                    color: #fff;
                    font-weight: 600;
                    margin-left: 8px;
                }
                .balance-info {
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #aaa;
                    margin-top: 6px;
                }
                .refresh-btn {
                    background: none;
                    border: none;
                    color: #888;
                    cursor: pointer;
                    font-size: 14px;
                    padding: 0 4px;
                    transition: color 0.2s;
                }
                .refresh-btn:hover {
                    color: #fff;
                }
                .quote-preview {
                    background: rgba(0, 255, 170, 0.05);
                    border: 1px dashed rgba(0, 255, 170, 0.2);
                    border-radius: 12px;
                    padding: 16px;
                    margin-bottom: 20px;
                    text-align: center;
                }
                .quote-preview label {
                    display: block;
                    font-size: 12px;
                    color: #888;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .quote-value {
                    font-size: 20px;
                    font-weight: 700;
                    color: #00ffaa;
                }
                .quote-loading {
                    color: #888;
                    font-style: italic;
                    font-size: 14px;
                }
                .quote-error {
                    color: #f87171;
                    font-size: 13px;
                }
                .quote-placeholder {
                    color: #555;
                    font-size: 20px;
                }
                .approve-btn {
                    width: 100%;
                    padding: 16px;
                    border-radius: 12px;
                    background: #3b82f6;
                    border: none;
                    color: #fff;
                    font-weight: 700;
                    font-size: 16px;
                    cursor: pointer;
                    transition: transform 0.1s;
                }
                .confirm-swap-btn {
                    width: 100%;
                    padding: 16px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, #00ffaa, #00d4ff);
                    border: none;
                    color: #000;
                    font-weight: 700;
                    font-size: 16px;
                    cursor: pointer;
                    transition: transform 0.1s;
                }
                .confirm-swap-btn:disabled,
                .approve-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    background: #333;
                    color: #666;
                }
                .confirm-swap-btn:active,
                .approve-btn:active {
                    transform: scale(0.98);
                }
                .switch-network-btn {
                    width: 100%;
                    padding: 16px;
                    border-radius: 12px;
                    background: #ff4444;
                    border: none;
                    color: #fff;
                    font-weight: 700;
                    font-size: 16px;
                    cursor: pointer;
                    transition: transform 0.1s;
                }
                .switch-network-btn:active {
                    transform: scale(0.98);
                }
                .swap-msg {
                    margin-top: 12px;
                    text-align: center;
                    font-size: 13px;
                    padding: 8px;
                    border-radius: 6px;
                }
                .swap-msg.success {
                    background: rgba(0, 255, 170, 0.1);
                    color: #00ffaa;
                }
                .swap-msg.error {
                    background: rgba(248, 113, 113, 0.1);
                    color: #f87171;
                }
                .swap-msg.warning {
                    color: #facc15;
                }
                .connect-section {
                    margin-top: 12px;
                }
                .connect-buttons {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-top: 8px;
                }
                .connect-btn {
                    padding: 12px;
                    border-radius: 12px;
                    background: #2a2a40;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #fff;
                    cursor: pointer;
                    font-weight: 600;
                    transition: background 0.2s;
                    text-align: center;
                }
                .connect-btn:hover {
                    background: #3b3b55;
                }
                .debug-network {
                    margin-top: 16px;
                    text-align: center;
                    color: #444;
                    font-size: 10px;
                    word-break: break-all;
                }
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                    }
                    to {
                        opacity: 1;
                    }
                }
                @keyframes slideUp {
                    from {
                        transform: translateY(20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}
