export const dynamic = "force-dynamic";

import LiveFeed from "@/components/LiveFeed";
import TipDegenButton from "@/components/TipDegenButton";

import UserProfile from "@/components/UserProfile";
import OnboardingModal from "@/components/OnboardingModal";

export default function Home() {
  return (
    <div className="dashboard">
      <OnboardingModal />

      {/* Fixed top bar */}
      <div className="top-bar">
        <header className="dashboard-header">
          <div className="logo-group">
            <img src="/logo.png?v=3" alt="LiquiTrace" className="logo-icon" />
            <span className="logo-text">LiquiTrace</span>
          </div>
          <UserProfile />
        </header>

        <div className="section-title">Signal Feed</div>

        <div className="tip-section">
          <span className="tip-label">Support LiquiTrace</span>
          <TipDegenButton />
        </div>
      </div>

      {/* Scrollable cards */}
      <div className="scroll-area">
        <LiveFeed />
      </div>
    </div>
  );
}
