import { NextResponse } from "next/server";
import { runBotScan } from "@/lib/bot";

const CRON_SECRET = process.env.CRON_SECRET;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    // 1. Security Check
    const authHeader = req.headers.get("authorization");
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const result = await runBotScan();
        return NextResponse.json(result);
    } catch (error) {
        console.error("Scan failed:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
