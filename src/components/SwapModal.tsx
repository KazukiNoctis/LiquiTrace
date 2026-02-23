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
    useCapabilities,
    useSendCalls,
    useSignTypedData,
} from "wagmi";
// import { useCapabilities, useWriteContracts } from "wagmi/experimental";
import { parseUnits, formatUnits, erc20Abi, maxUint256, encodeFunctionData, concat, numberToHex, size } from "viem";

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
        data: swapTxHash,
        isPending: isSwapPending,
        isSuccess: isSwapSubmitted,
        error: swapError,
        reset: resetSwap,
    } = useSendTransaction();

    // Track on-chain confirmation for standard swap
    const {
        isLoading: isSwapConfirming,
        isSuccess: isSwapConfirmed,
        isError: isSwapFailed,
        error: swapReceiptError,
    } = useWaitForTransactionReceipt({ hash: swapTxHash });

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
        sendCalls,
        isPending: isBatchPending,
        isSuccess: isBatchSuccess,
        error: batchError
    } = useSendCalls();

    const { signTypedDataAsync } = useSignTypedData();

    const [sellToken, setSellToken] = useState<"ETH" | "USDC">("ETH");
    const [amount, setAmount] = useState("0.01");
    const [quote, setQuote] = useState<any>(null);
    const [loadingQuote, setLoadingQuote] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [signError, setSignError] = useState<string | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [swapSellInfo, setSwapSellInfo] = useState<{ amount: string; token: string } | null>(null);

    // Determine if any swap has been confirmed on-chain
    const swapConfirmedOnChain = isSwapConfirmed || isBatchSuccess;
    const swapTxFailed = isSwapFailed;
    const isConfirmingOnChain = isSwapConfirming;
    const displayTxHash = swapTxHash;

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

    // Auto-refresh balances after on-chain confirmation
    useEffect(() => {
        if (swapConfirmedOnChain) {
            refetchEth();
            refetchUsdc();
        }
    }, [swapConfirmedOnChain, refetchEth, refetchUsdc]);

    // Reset swap state when modal opens fresh
    useEffect(() => {
        if (isOpen) {
            setSignError(null);
            setSwapSellInfo(null);
            resetSwap();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

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

    const handleSwap = async () => {
        if (!quote?.transaction) return;
        setSignError(null);
        setSwapSellInfo({ amount: sanitizedAmount, token: sellToken });

        let txData = quote.transaction.data as `0x${string}`;

        // For ERC-20 sells (USDC), sign the Permit2 EIP-712 message and append signature
        if (sellToken === "USDC" && quote.permit2?.eip712) {
            try {
                setIsSigning(true);
                const signature = await signTypedDataAsync(quote.permit2.eip712);

                // Append signature length (32-byte big-endian) + signature to tx data
                const signatureLengthInHex = numberToHex(size(signature), { signed: false, size: 32 });
                txData = concat([txData, signatureLengthInHex, signature]);
            } catch (err: any) {
                console.error("Permit2 signing failed:", err);
                setSignError(err?.shortMessage || err?.message || "Signature rejected");
                setIsSigning(false);
                return;
            } finally {
                setIsSigning(false);
            }
        }

        sendTransaction({
            to: quote.transaction.to,
            data: txData,
            value: BigInt(quote.transaction.value),
        });
    };

    const handleBatchSwap = async () => {
        if (!quote?.transaction) return;
        setSignError(null);
        setSwapSellInfo({ amount: sanitizedAmount, token: sellToken });

        let txData = quote.transaction.data as `0x${string}`;

        // For ERC-20 sells (USDC), sign the Permit2 EIP-712 message and append signature
        if (sellToken === "USDC" && quote.permit2?.eip712) {
            try {
                setIsSigning(true);
                const signature = await signTypedDataAsync(quote.permit2.eip712);

                const signatureLengthInHex = numberToHex(size(signature), { signed: false, size: 32 });
                txData = concat([txData, signatureLengthInHex, signature]);
            } catch (err: any) {
                console.error("Permit2 signing failed:", err);
                setSignError(err?.shortMessage || err?.message || "Signature rejected");
                setIsSigning(false);
                return;
            } finally {
                setIsSigning(false);
            }
        }

        const calls = [];
        const needsApprove =
            sellToken === "USDC" &&
            allowance !== undefined &&
            amountWei > 0n &&
            (allowance as bigint) < amountWei;

        if (needsApprove) {
            const approveData = encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [PERMIT2_ADDRESS, maxUint256]
            });

            calls.push({
                to: TOKENS.USDC.address as `0x${string}`,
                data: approveData,
                value: 0n
            });
        }

        // Add the swap call with signed data
        calls.push({
            to: quote.transaction.to as `0x${string}`,
            data: txData,
            value: BigInt(quote.transaction.value)
        });

        sendCalls({ calls });
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

    const isWorking = isApprovePending || isApproveConfirming || isSwapPending || isBatchPending || isSigning || isConfirmingOnChain;
    const finalError = swapError || batchError;
    const showResultPanel = isSwapSubmitted || isBatchSuccess || swapTxFailed;

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
                            {isSigning ? "Signing Permit..." : isSwapPending ? "Swapping..." : "Confirm Swap"}
                        </button>
                    )}

                    {btnState === "batch-swap" && (
                        <button
                            className="confirm-swap-btn"
                            disabled={!quote || loadingQuote || isWorking || !!quoteError}
                            onClick={handleBatchSwap}
                        >
                            {isSigning ? "Signing Permit..." : isBatchPending ? "Confirming Batch..." : "Swap (1-Click) ⚡"}
                        </button>
                    )}

                    {/* Status messages */}
                    {isApproveSuccess && !isBatchSuccess && !showResultPanel && (
                        <div className="swap-msg success">USDC Approved! Now Swap.</div>
                    )}

                    {/* ── Swap Result Panel ── */}
                    {showResultPanel && (
                        <div className="result-panel">
                            {/* Confirming on-chain */}
                            {isConfirmingOnChain && !swapConfirmedOnChain && !swapTxFailed && (
                                <div className="result-confirming">
                                    <div className="confirming-spinner" />
                                    <div className="result-title">Confirming on Base...</div>
                                    <div className="result-sub">Waiting for on-chain confirmation</div>
                                    {displayTxHash && (
                                        <a
                                            href={`https://basescan.org/tx/${displayTxHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="basescan-link"
                                        >
                                            View on BaseScan ↗
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* Confirmed */}
                            {swapConfirmedOnChain && (
                                <div className="result-success">
                                    <div className="result-icon">✅</div>
                                    <div className="result-title">Swap Successful!</div>
                                    {swapSellInfo && (
                                        <div className="result-detail">
                                            {swapSellInfo.amount} {swapSellInfo.token} → {tokenSymbol}
                                        </div>
                                    )}
                                    {displayTxHash && (
                                        <a
                                            href={`https://basescan.org/tx/${displayTxHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="basescan-link success"
                                        >
                                            View on BaseScan ↗
                                        </a>
                                    )}
                                    <div className="result-balance-update">
                                        Balance: {isBalanceLoading ? "Updating..." : displayBalance} {sellToken}
                                    </div>
                                    <button className="done-btn" onClick={onClose}>Done</button>
                                </div>
                            )}

                            {/* Failed */}
                            {swapTxFailed && (
                                <div className="result-failed">
                                    <div className="result-icon">❌</div>
                                    <div className="result-title">Swap Failed</div>
                                    <div className="result-sub">
                                        {swapReceiptError?.message?.slice(0, 80) || "Transaction reverted on-chain"}
                                    </div>
                                    {displayTxHash && (
                                        <a
                                            href={`https://basescan.org/tx/${displayTxHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="basescan-link fail"
                                        >
                                            View on BaseScan ↗
                                        </a>
                                    )}
                                    <button className="done-btn" onClick={() => { resetSwap(); setSwapSellInfo(null); }}>Try Again</button>
                                </div>
                            )}

                            {/* Submitted but not yet confirming (just sent) */}
                            {isSwapSubmitted && !isConfirmingOnChain && !swapConfirmedOnChain && !swapTxFailed && (
                                <div className="result-confirming">
                                    <div className="confirming-spinner" />
                                    <div className="result-title">Transaction Submitted</div>
                                    <div className="result-sub">Waiting for confirmation...</div>
                                </div>
                            )}
                        </div>
                    )}

                    {signError && (
                        <div className="swap-msg error">
                            Signing Error: {signError.slice(0, 60)}
                        </div>
                    )}
                    {finalError && !showResultPanel && (
                        <div className="swap-msg error">
                            Error: {finalError.message.slice(0, 50)}&hellip;
                        </div>
                    )}
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
                /* ── Result Panel ── */
                .result-panel {
                    margin-top: 16px;
                    border-radius: 12px;
                    overflow: hidden;
                    animation: fadeIn 0.2s ease;
                }
                .result-confirming,
                .result-success,
                .result-failed {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 20px 16px;
                    border-radius: 12px;
                    text-align: center;
                }
                .result-confirming {
                    background: rgba(0, 212, 255, 0.08);
                    border: 1px solid rgba(0, 212, 255, 0.2);
                }
                .result-success {
                    background: rgba(0, 255, 170, 0.08);
                    border: 1px solid rgba(0, 255, 170, 0.25);
                }
                .result-failed {
                    background: rgba(248, 113, 113, 0.08);
                    border: 1px solid rgba(248, 113, 113, 0.25);
                }
                .result-icon {
                    font-size: 32px;
                    margin-bottom: 4px;
                }
                .result-title {
                    font-size: 16px;
                    font-weight: 700;
                    color: #fff;
                }
                .result-detail {
                    font-size: 14px;
                    color: #00ffaa;
                    font-weight: 600;
                    font-family: monospace;
                }
                .result-sub {
                    font-size: 12px;
                    color: #888;
                }
                .result-balance-update {
                    font-size: 12px;
                    color: #aaa;
                    margin-top: 4px;
                    padding: 6px 12px;
                    background: rgba(255, 255, 255, 0.04);
                    border-radius: 8px;
                }
                .basescan-link {
                    display: inline-block;
                    font-size: 12px;
                    color: #00d4ff;
                    text-decoration: none;
                    padding: 4px 12px;
                    border-radius: 6px;
                    background: rgba(0, 212, 255, 0.08);
                    transition: all 0.2s;
                    margin-top: 4px;
                }
                .basescan-link:hover {
                    background: rgba(0, 212, 255, 0.15);
                }
                .basescan-link.success {
                    color: #00ffaa;
                    background: rgba(0, 255, 170, 0.08);
                }
                .basescan-link.fail {
                    color: #f87171;
                    background: rgba(248, 113, 113, 0.08);
                }
                .confirming-spinner {
                    width: 28px;
                    height: 28px;
                    border: 3px solid rgba(0, 212, 255, 0.2);
                    border-top-color: #00d4ff;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .done-btn {
                    width: 100%;
                    margin-top: 8px;
                    padding: 12px;
                    border-radius: 10px;
                    background: linear-gradient(135deg, #00ffaa, #00d4ff);
                    border: none;
                    color: #000;
                    font-weight: 700;
                    font-size: 14px;
                    cursor: pointer;
                    transition: transform 0.1s;
                }
                .done-btn:active {
                    transform: scale(0.98);
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
