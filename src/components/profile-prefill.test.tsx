import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileForm } from "./profile-form";
import { parseResumePrefill } from "@/lib/resume-prefill";
vi.mock("@/app/actions", () => ({saveProfileAction: vi.fn()}));
describe("editable import review", () => {
 it("prefills new uploads but preserves in-flight user edits and never saves automatically", () => {
  const {rerender} = render(<ProfileForm profile={null} />);
  fireEvent.change(screen.getByLabelText("Full name"), {target:{value:"My correction"}});
  fireEvent.input(screen.getByLabelText("Full name"));
  const draft = parseResumePrefill("Example Candidate\nFirmware Engineer\ncandidate@example.test\nSkills\nPython");
  rerender(<ProfileForm profile={null} draft={draft} importId="one" />);
  expect(screen.getByLabelText("Full name")).toHaveValue("My correction");
  expect(screen.getByLabelText("Email")).toHaveValue("candidate@example.test");
  expect(screen.getByLabelText("Comma or newline-separated skills")).toHaveValue("Python");
  expect(screen.getByText(/Review imported values/)).toBeVisible();
  fireEvent.input(screen.getByLabelText("Email"), {target:{value:""}});
  rerender(<ProfileForm profile={null} draft={draft} importId="two" />);
  expect(screen.getByLabelText("Email")).toHaveValue("");
 });
});
