"""
LiquiTrace – centralised configuration.
Reads values from ../.env (or environment variables).
"""

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_RPC_URL     = os.getenv("BASE_RPC_URL", "https://mainnet.base.org")
SUPABASE_URL     = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY     = os.getenv("SUPABASE_KEY", "")
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
REFERRAL_WALLET  = os.getenv("REFERRAL_WALLET", "")
