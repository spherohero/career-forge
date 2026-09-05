"use client";

import {
  BriefcaseBusiness,
  Columns3,
  LayoutDashboard,
  Settings,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  identity?: string | null;
}

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs", label: "Roles", icon: BriefcaseBusiness },
  { href: "/tracker", label: "Tracker", icon: Columns3 },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function AppShell({ children, identity }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Career Forge home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Career</strong> Forge</span>
        </Link>
        <p className="sidebar-kicker">Evidence-first career workspace</p>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              aria-current={isCurrentRoute(pathname, href) ? "page" : undefined}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="security-dot" aria-hidden="true" />
          <div>
            <span>Protected workspace</span>
            <strong>{identity || "Local workspace"}</strong>
          </div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            aria-current={isCurrentRoute(pathname, href) ? "page" : undefined}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
