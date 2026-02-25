import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://liquitrace.vercel.app";

/**
 * GET /api/test-notify?secret=YOUR_CRON_SECRET
 * 
 * Debug endpoint to manually trigger a test notification.
 * Returns detailed diagnostic info about subscribers and Farcaster API response.
 */
export async function GET(req: Request) {
    // Auth check
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const diagnostics: any = { step: "init", subscribers: null, sendResult: null };

    try {
        // 1. Check subscribers
        const { data: subs, error: subErr } = await supabase
            .from("notification_subscribers")
            .select("*");

        diagnostics.step = "fetched_subscribers";
        diagnostics.subscribers = {
            count: subs?.length || 0,
            error: subErr?.message || null,
            data: subs?.map(s => ({
                fid: s.fid,
                tokenPreview: s.token?.slice(0, 12) + "...",
                notification_url: s.notification_url,
                created_at: s.created_at,
            })) || [],
        };

        if (subErr || !subs || subs.length === 0) {
            return NextResponse.json({
                success: false,
                message: "No subscribers found or query error",
                diagnostics,
            });
        }

        // 2. Group tokens
        const groups = new Map<string, string[]>();
        for (const s of subs) {
            const arr = groups.get(s.notification_url) || [];
            arr.push(s.token);
            groups.set(s.notification_url, arr);
        }

        diagnostics.step = "sending_test";
        diagnostics.sendResult = [];

        // 3. Send test notification
        for (const [url, tokens] of groups) {
            const payload = {
                notificationId: `test-${Date.now()}`,
                title: "LiquiTrace Test",
                body: "If you see this, notifications work!",
                targetUrl: APP_URL,
                tokens,
            };

            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                const resBody = await res.json().catch(() => null);

                diagnostics.sendResult.push({
                    url,
                    status: res.status,
                    statusText: res.statusText,
                    response: resBody,
                    tokenCount: tokens.length,
                });
            } catch (err: any) {
                diagnostics.sendResult.push({
                    url,
                    error: err.message,
                    tokenCount: tokens.length,
                });
            }
        }

        diagnostics.step = "done";
        return NextResponse.json({ success: true, diagnostics });
    } catch (err: any) {
        diagnostics.error = err.message;
        return NextResponse.json({ success: false, diagnostics });
    }
}
