"""
Migration script to add new columns to the signals table for Top Gainers mode.
"""
import logging
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration")

def run_migration():
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("Supabase credentials missing.")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Supabase-py client doesn't support direct SQL execution easily for schema changes 
    # via the standard client unless using the rpc interface or specific extensions.
    # However, since we are in dev mode and I cannot easily run psql, I will rely on
    # the user (or previous instructions) having run this, OR I will try to use 
    # the existing connection if possible.
    
    # Actually, for this environment, since I can't interactively run SQL, 
    # I will stick to the plan of asking the user or assuming it's done? 
    # Wait, the error said "Could not find column ... in schema cache". 
    # Sometimes just reloading the schema cache is enough if the column exists, 
    # but here it likely doesn't exist.
    
    # Since I don't have a direct SQL runner for Supabase in this python env 
    # (unless I use psycopg2 which might not be installed), 
    # I will instruct the user to run the SQL. 
    # BUT, I can try to use the `rpc` call if there is a SQL runner function, which there isn't.
    
    # Alternative: I'll use the `requests` library to call Supabase SQL API if enabled, 
    # or just tell the user. 
    # actually, I'll print the instructions for the user to run in the Supabase SQL Editor.
    
    print("\n⚠️  AUTOMATED MIGRATION NOT POSSIBLE VIA PYTHON CLIENT ⚠️")
    print("Please run the following SQL in your Supabase SQL Editor:\n")
    print("""
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS price_change_pct NUMERIC DEFAULT 0;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS volume_24h NUMERIC DEFAULT 0;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS market_cap NUMERIC DEFAULT 0;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS dex_url TEXT DEFAULT '';
    
    -- Refresh schema cache
    NOTIFY pgrst, 'reload schema';
    """)

if __name__ == "__main__":
    run_migration()
