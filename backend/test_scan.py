"""Quick wide-scan test — looks back 5000 blocks to find PairCreated events."""
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(name)-22s  %(levelname)-7s  %(message)s")

from bot import get_web3, get_pair_created_events, get_pool_liquidity_eth, passes_filter, get_token_info, build_swap_link

w3 = get_web3()
latest = w3.eth.block_number
events = get_pair_created_events(w3, latest - 50000, latest)

print(f"\n{'='*60}")
print(f"Found {len(events)} PairCreated event(s) in last 5000 blocks")
print(f"{'='*60}\n")

WETH = "0x4200000000000000000000000000000000000006"
for e in events[:5]:
    t0, t1, pair = e["token0"], e["token1"], e["pair_address"]
    target = t1 if t0.lower() == WETH.lower() else (t0 if t1.lower() == WETH.lower() else None)
    if not target:
        print(f"  SKIP {pair} — no WETH side")
        continue

    liq = get_pool_liquidity_eth(w3, pair)
    info = get_token_info(w3, target)
    passed = passes_filter(liq)
    link = build_swap_link(target)

    print(f"  Token: {info['name']} ({info['symbol']})")
    print(f"  Pair:  {pair}")
    print(f"  Liq:   {liq:.4f} ETH  {'✅ PASS' if passed else '❌ SKIP (<5 ETH)'}")
    print(f"  Swap:  {link[:80]}...")
    print()
