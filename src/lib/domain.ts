import { z } from "zod";

export const jobStatusSchema = z.enum([
  "saved",
  "tailoring",
  "ready",
  "applied",
  "interview",
  "offer",
  "rejected",
  "archived",
]);

export const workModelSchema = z.enum([
  "onsite",
  "hybrid",
  "remote",
  "unknown",
]);

const webUrlSchema = z.url().refine((url) => {
  const protocol = new URL(url).protocol;
  return protocol === "http:" || protocol === "https:";
}, "URL must use http or https");

export const jobInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  company: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160).default(""),
  workModel: workModelSchema.default("unknown"),
  url: webUrlSchema.optional(),
  description: z.string().trim().min(20).max(100_000),
  source: z.string().trim().min(1).max(80).default("manual"),
  salary: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(10_000).optional(),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type JobInput = z.input<typeof jobInputSchema>;

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  workModel: WorkModel;
  url: string | null;
  description: string;
  source: string;
  salary: string | null;
  notes: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationEvent {
  id: string;
  jobId: string;
  fromStatus: JobStatus;
  toStatus: JobStatus;
  note: string | null;
  createdAt: string;
}

const optionalId = z.uuid().optional();
const dateValue = z.string().trim().max(40).nullable().default(null);

export const achievementInputSchema = z.object({
  id: optionalId,
  text: z.string().trim().min(1).max(2_000),
  evidence: z.string().trim().max(2_000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  verified: z.boolean().default(true),
});

export const profileInputSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  email: z.email(),
  phone: z.string().trim().max(80).default(""),
  location: z.string().trim().max(160).default(""),
  headline: z.string().trim().max(240).default(""),
  summary: z.string().trim().max(3_000).default(""),
  skills: z.array(
    z.object({
      id: optionalId,
      name: z.string().trim().min(1).max(80),
      category: z.string().trim().max(80).default("General"),
      verified: z.boolean().default(true),
    }),
  ),
  experiences: z.array(
    z.object({
      id: optionalId,
      organization: z.string().trim().min(1).max(160),
      role: z.string().trim().min(1).max(160),
      location: z.string().trim().max(160).default(""),
      startDate: dateValue,
      endDate: dateValue,
      achievements: z.array(achievementInputSchema).default([]),
    }),
  ),
  projects: z.array(
    z.object({
      id: optionalId,
      name: z.string().trim().min(1).max(160),
      url: webUrlSchema.nullable().optional(),
      summary: z.string().trim().max(2_000).default(""),
      startDate: dateValue,
      endDate: dateValue,
      achievements: z.array(achievementInputSchema).default([]),
    }),
  ),
  education: z.array(
    z.object({
      id: optionalId,
      institution: z.string().trim().min(1).max(160),
      degree: z.string().trim().max(160).default(""),
      field: z.string().trim().max(160).default(""),
      startDate: dateValue,
      endDate: dateValue,
      details: z.string().trim().max(2_000).default(""),
    }),
  ),
});

export type ProfileInput = z.input<typeof profileInputSchema>;

export interface Achievement {
  id: string;
  text: string;
  evidence: string | null;
  skills: string[];
  verified: boolean;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  verified: boolean;
}

export interface Experience {
  id: string;
  organization: string;
  role: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  achievements: Achievement[];
}

export interface Project {
  id: string;
  name: string;
  url: string | null;
  summary: string;
  startDate: string | null;
  endDate: string | null;
  achievements: Achievement[];
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startDate: string | null;
  endDate: string | null;
  details: string;
}

export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  skills: Skill[];
  experiences: Experience[];
  projects: Project[];
  education: Education[];
  updatedAt: string;
}
