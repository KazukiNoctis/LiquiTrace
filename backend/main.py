"""
LiquiTrace – entry point.
Wires up APScheduler to run the top-gainers scanner every 5 minutes.
"""

import logging
from apscheduler.schedulers.blocking import BlockingScheduler

from config import SUPABASE_URL
from bot import scan_top_gainers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-22s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("liquitrace.main")


def main() -> None:
    print("🟢 LiquiTrace backend starting …")
    print("   Source    → DexScreener API (Top Gainers on Base)")
    print(f"   Supabase  → {SUPABASE_URL[:30]}…" if SUPABASE_URL else "   Supabase  → (not set)")

    # Run one scan immediately on start-up
    scan_top_gainers()

    # Schedule future scans every 5 minutes (hemat – no 24/7 streaming)
    scheduler = BlockingScheduler()
    scheduler.add_job(scan_top_gainers, "interval", minutes=5, id="signal_scan")
    logger.info("Scheduler started – scanning every 5 min. Press Ctrl+C to stop.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down scheduler …")


if __name__ == "__main__":
    main()
