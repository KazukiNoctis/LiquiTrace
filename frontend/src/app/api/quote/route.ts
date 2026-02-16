"use strict";

import { NextRequest, NextResponse } from "next/server";

const ZERO_EX_API_KEY = process.env.NEXT_PUBLIC_ZERO_EX_API_KEY; // OR use a non-public var if preferred

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    // Forward all params (sellToken, buyToken, sellAmount, chainId, etc.)
    const params = new URLSearchParams(searchParams);

    const paramsObj = Object.fromEntries(params.entries());
    console.log("0x Proxy Request:", paramsObj);

    // API Key check
    if (!ZERO_EX_API_KEY) {
        console.error("Missing 0x API Key");
        return NextResponse.json({ error: "Missing API Key configuration" }, { status: 500 });
    }

    const headers = {
        "0x-api-key": ZERO_EX_API_KEY,
        "0x-version": "v2",
    };

    try {
        const url = `https://api.0x.org/swap/permit2/quote?${params}`;
        console.log("Fetching 0x URL:", url);

        const res = await fetch(url, {
            headers,
        });

        const data = await res.json();

        if (!res.ok) {
            console.error("0x API Error Response:", data);
            return NextResponse.json(data, { status: res.status });
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("0x API Proxy Exception:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
