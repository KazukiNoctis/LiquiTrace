"use client";

import { useEffect, useState } from "react";

export default function OnboardingModal() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Check if user has seen onboarding
        const hasSeen = localStorage.getItem("hasSeenOnboarding_v1");
        if (!hasSeen) {
            setIsOpen(true);
        }
    }, []);

    const handleClose = () => {
        localStorage.setItem("hasSeenOnboarding_v1", "true");
        setIsOpen(false);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="onboarding-card">
                <div className="icon-group">
                    <img src="/logo.png?v=3" alt="LiquiTrace" className="onboarding-logo" />
                    <div className="pulse-ring" />
                </div>

                <h2>Welcome to LiquiTrace</h2>
                <p className="subtitle">Real-time signal feed on Base 🔵</p>

                <div className="steps-list">
                    <div className="step-item">
                        <span className="step-emoji">🚀</span>
                        <div className="step-text">
                            <strong>Live Gainers</strong>
                            <span>Instant signals for new liquidity & volume spikes.</span>
                        </div>
                    </div>
                    <div className="step-item">
                        <span className="step-emoji">⚡</span>
                        <div className="step-text">
                            <strong>Instant Swap</strong>
                            <span>Trade promising tokens directly in-app.</span>
                        </div>
                    </div>
                    <div className="step-item">
                        <span className="step-emoji">🎩</span>
                        <div className="step-text">
                            <strong>Tip Creators</strong>
                            <span>Support the build with $DEGEN tips.</span>
                        </div>
                    </div>
                </div>

                <button onClick={handleClose} className="start-btn">
                    Let's Go 🚀
                </button>
            </div>
        </div>
    );
}
