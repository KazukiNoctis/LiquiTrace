import requests

API_KEY = "1f6951a1-dbfc-49bf-a2fd-69911ffc1d42"
CHAIN_ID = 8453
SELL_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" # USDC (Base)
BUY_TOKEN = "0x4200000000000000000000000000000000000006" # WETH (as target)
SELL_AMOUNT = "1000000" # 1 USDC (6 decimals)

url = "https://api.0x.org/swap/permit2/quote"
headers = {
    "0x-api-key": API_KEY,
    "0x-version": "v2"
}
params = {
    "chainId": CHAIN_ID,
    "sellToken": SELL_TOKEN,
    "buyToken": BUY_TOKEN,
    "sellAmount": SELL_AMOUNT,
    "taker": "0xd97653d8b1BE78bDf9179c31BDF41cEad8E1f504" # Use referral wallet as dummy taker
}

print(f"Requesting: {url}")
print(f"Params: {params}")

try:
    res = requests.get(url, headers=headers, params=params)
    data = res.json()
    # print(f"Status: {res.status_code}")
    print(f"TARGET: {data.get('allowanceTarget')}")
    # print(f"Issues: {data.get('issues')}")
    # print(f"Response: {res.text}")
except Exception as e:
    print(f"Error: {e}")
