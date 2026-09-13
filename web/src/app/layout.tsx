import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";
import { NavBar } from "@/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RISE Sports",
  description: "Tournaments, live scoring, ratings and ledgers across seven sports.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The padding keeps the fixed nav bar off the last line of every page —
          without it the bottom of a long roster sits underneath it. */}
      <body className="flex min-h-full flex-col pb-16">
        {children}
        <NavBar />
        <ServiceWorker version={process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"} />
      </body>
    </html>
  );
}
