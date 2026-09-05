import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

function renderAt(pathname: string, identity?: string | null) {
  usePathnameMock.mockReturnValue(pathname);
  render(<AppShell identity={identity}>Workspace content</AppShell>);

  return {
    desktop: screen.getByRole("navigation", { name: "Primary navigation" }),
    mobile: screen.getByRole("navigation", { name: "Mobile navigation" }),
  };
}

function expectOnlyCurrentLink(navigation: HTMLElement, label: string) {
  const links = within(navigation).getAllByRole("link");
  expect(links.filter((link) => link.getAttribute("aria-current") === "page"))
    .toEqual([within(navigation).getByRole("link", { name: label })]);
}

function expectNoCurrentLink(navigation: HTMLElement) {
  expect(
    within(navigation)
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current")),
  ).toEqual([]);
}

describe("AppShell", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it("marks Overview current in both navigations only at the root route", () => {
    const { desktop, mobile } = renderAt("/");

    expectOnlyCurrentLink(desktop, "Overview");
    expectOnlyCurrentLink(mobile, "Overview");
  });

  it.each(["/jobs", "/jobs/software-engineer"])(
    "marks Roles current in both navigations at %s",
    (pathname) => {
      const { desktop, mobile } = renderAt(pathname);

      expectOnlyCurrentLink(desktop, "Roles");
      expectOnlyCurrentLink(mobile, "Roles");
    },
  );

  it.each([
    ["/tracker", "Tracker"],
    ["/profile", "Profile"],
  ])("marks %s current in both navigations", (pathname, label) => {
    const { desktop, mobile } = renderAt(pathname);

    expectOnlyCurrentLink(desktop, label);
    expectOnlyCurrentLink(mobile, label);
  });

  it.each(["/settings", "/settings/connection"])("makes Settings reachable and current in both navigations at %s", (pathname) => {
    const { desktop, mobile } = renderAt(pathname);

    expectOnlyCurrentLink(desktop, "Settings");
    expectOnlyCurrentLink(mobile, "Settings");
    expect(within(mobile).getAllByRole("link")).toHaveLength(5);
    expect(within(mobile).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("does not mark Settings current for a shared prefix", () => {
    const { desktop, mobile } = renderAt("/settings2");
    expectNoCurrentLink(desktop);
    expectNoCurrentLink(mobile);
  });

  it("does not treat a route with only a shared prefix as current", () => {
    const { desktop, mobile } = renderAt("/jobs2");

    expectNoCurrentLink(desktop);
    expectNoCurrentLink(mobile);
  });

  it("uses public-facing workspace copy", () => {
    renderAt("/");

    expect(screen.getByText("Evidence-first career workspace")).toBeInTheDocument();
    expect(screen.getByText("Protected workspace")).toBeInTheDocument();
    expect(screen.queryByText("Private career workshop")).not.toBeInTheDocument();
    expect(screen.queryByText("Authelia protected")).not.toBeInTheDocument();
  });

  it.each([
    ["person@example.com", "person@example.com"],
    [null, "Local workspace"],
  ])("preserves the shell identity value %#", (identity, expected) => {
    renderAt("/", identity);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
