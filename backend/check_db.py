from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("check_db")

def check():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing credentials.")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Check row count
    try:
        res = sb.table("signals").select("*", count="exact").limit(1).execute()
        count = res.count
        data = res.data
        print(f"✅ Connection successful!")
        print(f"📊 Total rows in 'signals': {count}")
        if data:
            print("First row sample:", data[0])
        else:
            print("Table is empty.")
            
    except Exception as e:
        print(f"❌ Error query Supabase: {e}")

if __name__ == "__main__":
    check()
