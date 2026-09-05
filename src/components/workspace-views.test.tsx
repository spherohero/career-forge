import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Job, Profile } from "@/lib/domain";
import type { ResumeVersion } from "@/lib/analysis";
import { JobsView } from "./jobs-view";
import { TrackerBoard } from "./tracker-board";
import { JobWorkspace } from "./job-workspace";
import { ResumeImportPanel } from "./resume-import-panel";

const job: Job = {
  id: "job-1",
  title: "Firmware Engineer",
  company: "Signal Labs",
  location: "Remote",
  workModel: "remote",
  url: "https://example.com/job",
  description: "Required qualifications:\n- C++ firmware\n- SPI debugging",
  source: "manual",
  salary: null,
  notes: null,
  status: "saved",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const profile: Profile = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "",
  location: "London",
  headline: "Engineer",
  summary: "",
  skills: [{ id: "skill-cpp", name: "C++", category: "General", verified: true }],
  experiences: [],
  projects: [],
  education: [],
  updatedAt: "2026-09-03T00:00:00.000Z",
};

describe("JobsView", () => {
  it("shows a useful empty state", () => {
    render(<JobsView jobs={[]} />);
    expect(screen.getByRole("heading", { name: /no saved roles/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add your first role/i })).toHaveAttribute("href", "/jobs/new");
  });

  it("links saved roles to their workspace", () => {
    render(<JobsView jobs={[job]} />);
    expect(screen.getByRole("link", { name: /firmware engineer/i })).toHaveAttribute("href", "/jobs/job-1");
  });
});

describe("TrackerBoard", () => {
  it("renders every pipeline stage and real job links", () => {
    render(<TrackerBoard jobs={[job]} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(8);
    expect(screen.getByRole("heading", { name: "Saved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /firmware engineer/i })).toHaveAttribute("href", "/jobs/job-1");
  });
});

describe("JobWorkspace", () => {
  it("explains evidenced requirements with a numeric count", () => {
    render(<JobWorkspace job={job} profile={profile} version={null} />);
    expect(screen.getByText("1 of 2 evidenced")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /matched evidence/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /missing evidence/i })).toBeInTheDocument();
    expect(screen.getAllByText(/C\+\+ firmware/)).toHaveLength(2);
  });

  it("shows source, proposal, rationale, evidence and review actions", () => {
    const version: ResumeVersion = {
      id: "version-1",
      jobId: job.id,
      name: "Signal Labs · Firmware Engineer · v1",
      mode: "deterministic",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
      suggestions: [{
        id: "suggestion-1",
        sourceAchievementId: "achievement-1",
        originalText: "Built SPI firmware.",
        revisedText: "Built SPI firmware.",
        rationale: "Supports a verified requirement.",
        matchedRequirementIds: ["requirement-2"],
        evidence: "Bench logs",
        status: "pending",
      }],
    };
    render(<JobWorkspace job={job} profile={profile} version={version} />);
    const suggestion = screen.getByTestId("suggestion-suggestion-1");
    expect(within(suggestion).getAllByText("Built SPI firmware.")).toHaveLength(2);
    expect(within(suggestion).getByText("Supports a verified requirement.")).toBeInTheDocument();
    expect(within(suggestion).getByText("Bench logs")).toBeInTheDocument();
    expect(within(suggestion).getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(within(suggestion).getByRole("button", { name: /reject/i })).toBeInTheDocument();
    expect(screen.getByText("Deterministic")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download DOCX/i })).toHaveAttribute("href", "/api/resume/version-1/docx");
    expect(screen.getByRole("link", { name: /download PDF/i })).toHaveAttribute("href", "/api/resume/version-1/pdf");
  });
});

describe("ResumeImportPanel", () => {
  it("keeps imported text visibly unverified and separate from the profile form", () => {
    render(<ResumeImportPanel latest={{ id: "import-1", originalFilename: "resume.txt", mediaType: "text/plain", extractedText: "Candidate supplied text", createdAt: "2026-09-03T00:00:00.000Z", status: "pending_review" }} />);
    expect(screen.getByText(/unverified import/i)).toBeInTheDocument();
    expect(screen.getByText("Candidate supplied text")).toBeInTheDocument();
    expect(screen.getByText(/review and attest/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/resume file/i)).toHaveAttribute("accept", ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain");
  });
});
