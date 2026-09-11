
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { SmoothCursor } from "@/components/ui/smooth-cursor";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SkillSync",
  description:
    "Compare job requirements with your portfolio to find skill gaps and generate a tailored pitch.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <SmoothCursor />
          
          <div className="fixed left-4 top-4 z-50">
            <AnimatedThemeToggler
              aria-label="Toggle theme"
              className="text-foreground/70 hover:text-foreground transition-colors"
            />
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}
