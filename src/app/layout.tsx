import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LiquiTrace – Base Signal Dashboard",
  description:
    "Real-time token signal feed from Aerodrome on Base. Swap via 0x and tip with $DEGEN.",
  icons: {
    icon: "/logo.png",
  },
  other: {
    "base:app_id": "6995948525337829d86a5416",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
