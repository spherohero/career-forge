import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Career Forge",
    template: "%s · Career Forge",
  },
  description: "Private, evidence-first job search and resume tailoring workspace.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const identity = requestHeaders.get("remote-user");

  return (
    <html lang="en">
      <body>
        <AppShell identity={identity}>{children}</AppShell>
      </body>
    </html>
  );
}
