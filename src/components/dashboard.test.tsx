import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard";

describe("Dashboard", () => {
  it("guides a new user to create a profile before tailoring", () => {
    render(<Dashboard jobs={[]} profile={null} />);

    expect(
      screen.getByRole("heading", { name: /build your verified career profile/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set up profile/i })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.getByRole("link", { name: /set up profile/i })).toHaveClass(
      "button-primary",
    );
    expect(screen.getByRole("link", { name: /add a role/i })).toHaveClass(
      "button-secondary",
    );
    expect(screen.queryByRole("link", { name: /view all roles/i })).not.toBeInTheDocument();
  });

  it("summarizes active applications", () => {
    render(
      <Dashboard
        profile={{
          fullName: "Alex Morgan",
          email: "alex.morgan@example.test",
          phone: "",
          location: "Austin, TX",
          headline: "Embedded Systems Engineer",
          summary: "Embedded systems engineer.",
          skills: [],
          experiences: [],
          projects: [],
          education: [],
          updatedAt: "2026-09-03T00:00:00.000Z",
        }}
        jobs={[
          {
            id: "job-1",
            title: "Firmware Intern",
            company: "Acme",
            location: "Remote",
            workModel: "remote",
            url: null,
            description: "Develop and test embedded firmware for connected products.",
            source: "manual",
            salary: null,
            notes: null,
            status: "applied",
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-09-03T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Firmware Intern")).toBeInTheDocument();
  });
});
