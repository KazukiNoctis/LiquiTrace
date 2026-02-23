import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// --------------------------------------------------------------------------
// Supabase client (service role for server-side writes)
// --------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function decodeBase64Url(str: string): string {
    // base64url → base64
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
}

// --------------------------------------------------------------------------
// POST /api/webhook — Farcaster Mini App Webhook Handler
// --------------------------------------------------------------------------

export async function POST(req: Request) {
    try {
        const body = await req.json();

        // Farcaster sends { header, payload, signature } as base64url strings
        const headerJson = JSON.parse(decodeBase64Url(body.header));
        const payloadJson = JSON.parse(decodeBase64Url(body.payload));

        const fid: number = headerJson.fid;
        const event: string = payloadJson.event;

        if (!fid || !event) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        console.log(`[Webhook] event=${event} fid=${fid}`);

        switch (event) {
            case "miniapp_added":
            case "notifications_enabled": {
                const details = payloadJson.notificationDetails;
                if (!details?.token || !details?.url) {
                    console.warn(`[Webhook] ${event} missing notificationDetails`);
                    return NextResponse.json({ ok: true });
                }

                const { error } = await supabase
                    .from("notification_subscribers")
                    .upsert(
                        {
                            fid,
                            token: details.token,
                            notification_url: details.url,
                            updated_at: new Date().toISOString(),
                        },
                        { onConflict: "fid,token" }
                    );

                if (error) {
                    console.error(`[Webhook] Upsert error:`, error);
                } else {
                    console.log(`[Webhook] Subscriber saved: fid=${fid}`);
                }
                break;
            }

            case "miniapp_removed":
            case "notifications_disabled": {
                const { error } = await supabase
                    .from("notification_subscribers")
                    .delete()
                    .eq("fid", fid);

                if (error) {
                    console.error(`[Webhook] Delete error:`, error);
                } else {
                    console.log(`[Webhook] Subscriber removed: fid=${fid}`);
                }
                break;
            }

            default:
                console.log(`[Webhook] Unknown event: ${event}`);
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("[Webhook] Handler error:", err);
        return NextResponse.json({ ok: true }); // Always return 200 to avoid retries
    }
}
