import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ResumeVersion,
  TailoringPlan,
  TailoringSuggestion,
} from "@/lib/analysis";
import { canonicalizeIdentity } from "@/lib/auth";
import {
  jobInputSchema,
  jobStatusSchema,
  profileInputSchema,
  type ApplicationEvent,
  type Achievement,
  type Job,
  type JobInput,
  type JobStatus,
  type Profile,
  type ProfileInput,
  type WorkModel,
} from "@/lib/domain";

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string;
  work_model: WorkModel;
  url: string | null;
  description: string;
  source: string;
  salary: string | null;
  notes: string | null;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  job_id: string;
  from_status: JobStatus;
  to_status: JobStatus;
  note: string | null;
  created_at: string;
}

export interface ResumeImport {
  id: string;
  originalFilename: string;
  mediaType: string;
  extractedText: string;
  createdAt: string;
  status: "pending_review";
}

interface ResumeImportRow {
  id: string;
  original_filename: string;
  media_type: string;
  extracted_text: string;
  created_at: string;
  status: "pending_review";
}

export interface AiConnection {
  identity: string;
  provider: "openai-codex";
  credentialCiphertext: string;
  model: string;
  expiresAt: string;
  status: "connected" | "reauth_required";
  connectedAt: string;
  updatedAt: string;
}

interface AiConnectionRow {
  identity: string;
  provider: "openai-codex";
  credential_ciphertext: string;
  model: string;
  expires_at: string;
  status: "connected" | "reauth_required";
  connected_at: string;
  updated_at: string;
}

export interface AiDeviceFlow {
  id: string;
  identity: string;
  provider: "openai-codex";
  stateCiphertext: string;
  expiresAt: string;
  createdAt: string;
}

interface AiDeviceFlowRow {
  id: string;
  identity: string;
  provider: "openai-codex";
  state_ciphertext: string;
  expires_at: string;
  created_at: string;
}

function mapResumeImport(row: ResumeImportRow): ResumeImport {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mediaType: row.media_type,
    extractedText: row.extracted_text,
    createdAt: row.created_at,
    status: row.status,
  };
}

function mapAiConnection(row: AiConnectionRow): AiConnection {
  return {
    identity: row.identity,
    provider: row.provider,
    credentialCiphertext: row.credential_ciphertext,
    model: row.model,
    expiresAt: row.expires_at,
    status: row.status,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function mapAiDeviceFlow(row: AiDeviceFlowRow): AiDeviceFlow {
  return {
    id: row.id,
    identity: row.identity,
    provider: row.provider,
    stateCiphertext: row.state_ciphertext,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    workModel: row.work_model,
    url: row.url,
    description: row.description,
    source: row.source,
    salary: row.salary,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): ApplicationEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at,
  };
}

export class CareerRepository {
  private constructor(private readonly database: Database.Database) {
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  static inMemory(): CareerRepository {
    return new CareerRepository(new Database(":memory:"));
  }

  static open(path: string): CareerRepository {
    mkdirSync(dirname(path), { recursive: true });
    const database = new Database(path);
    database.pragma("journal_mode = WAL");
    return new CareerRepository(database);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        work_model TEXT NOT NULL DEFAULT 'unknown',
        url TEXT,
        description TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        salary TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'saved',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
      CREATE INDEX IF NOT EXISTS events_job_idx
        ON application_events(job_id, sequence);

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resume_versions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS resume_versions_job_idx
        ON resume_versions(job_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS resume_imports (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        original_filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        extracted_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'pending_review')
      );

      CREATE INDEX IF NOT EXISTS resume_imports_created_idx
        ON resume_imports(sequence DESC);

      CREATE TABLE IF NOT EXISTS ai_connections (
        identity TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider = 'openai-codex'),
        credential_ciphertext TEXT NOT NULL,
        model TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('connected', 'reauth_required')),
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_device_flows (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider = 'openai-codex'),
        state_ciphertext TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ai_device_flows_identity_idx
        ON ai_device_flows(identity, created_at DESC);
    `);
  }

  createJob(input: JobInput): Job {
    const data = jobInputSchema.parse(input);
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database
      .prepare(
        `INSERT INTO jobs (
          id, title, company, location, work_model, url, description,
          source, salary, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.company,
        data.location,
        data.workModel,
        data.url ?? null,
        data.description,
        data.source,
        data.salary ?? null,
        data.notes ?? null,
        now,
        now,
      );

    return this.getJob(id)!;
  }

  getJob(id: string): Job | null {
    const row = this.database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  listJobs(): Job[] {
    const rows = this.database
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
      .all() as JobRow[];
    return rows.map(mapJob);
  }

  updateJobStatus(
    id: string,
    nextStatus: JobStatus,
    note?: string,
  ): Job | null {
    const parsedStatus = jobStatusSchema.parse(nextStatus);
    const update = this.database.transaction(() => {
      const job = this.getJob(id);
      if (!job) return null;

      const now = new Date().toISOString();
      this.database
        .prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?")
        .run(parsedStatus, now, id);
      this.database
        .prepare(
          `INSERT INTO application_events (
            id, job_id, from_status, to_status, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          job.status,
          parsedStatus,
          note?.trim() || null,
          now,
        );

      return this.getJob(id);
    });

    return update();
  }

  listApplicationEvents(jobId: string): ApplicationEvent[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM application_events WHERE job_id = ? ORDER BY sequence ASC",
      )
      .all(jobId) as EventRow[];
    return rows.map(mapEvent);
  }

  saveProfile(input: ProfileInput): Profile {
    const data = profileInputSchema.parse(input);
    const now = new Date().toISOString();
    const existing = this.getProfile();
    const oldSkills = [...(existing?.skills ?? [])];
    const oldExperiences = [...(existing?.experiences ?? [])];
    const oldProjects = [...(existing?.projects ?? [])];
    const oldEducation = [...(existing?.education ?? [])];
    const take = <T,>(items: T[], matches: (item: T) => boolean): T | undefined => {
      const index = items.findIndex(matches);
      return index < 0 ? undefined : items.splice(index, 1)[0];
    };
    const materializeAchievement = (
      achievement: (typeof data.experiences)[number]["achievements"][number],
      prior: Achievement[],
    ): Achievement => ({
      id: achievement.id ?? take(prior, (item) => item.text === achievement.text)?.id ?? randomUUID(),
      text: achievement.text,
      evidence: achievement.evidence ?? null,
      skills: achievement.skills,
      verified: achievement.verified,
    });

    const profile: Profile = {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      location: data.location,
      headline: data.headline,
      summary: data.summary,
      skills: data.skills.map((skill) => ({
        id: skill.id ?? take(oldSkills, (item) => item.name.toLowerCase() === skill.name.toLowerCase())?.id ?? randomUUID(),
        name: skill.name,
        category: skill.category,
        verified: skill.verified,
      })),
      experiences: data.experiences.map((experience) => {
        const prior = take(oldExperiences, (item) => item.organization === experience.organization && item.role === experience.role && item.startDate === experience.startDate);
        const priorAchievements = [...(prior?.achievements ?? [])];
        return {
        id: experience.id ?? prior?.id ?? randomUUID(),
        organization: experience.organization,
        role: experience.role,
        location: experience.location,
        startDate: experience.startDate,
        endDate: experience.endDate,
        achievements: experience.achievements.map((achievement) => materializeAchievement(achievement, priorAchievements)),
      }; }),
      projects: data.projects.map((project) => {
        const prior = take(oldProjects, (item) => item.name === project.name);
        const priorAchievements = [...(prior?.achievements ?? [])];
        return {
        id: project.id ?? prior?.id ?? randomUUID(),
        name: project.name,
        url: project.url ?? null,
        summary: project.summary,
        startDate: project.startDate,
        endDate: project.endDate,
        achievements: project.achievements.map((achievement) => materializeAchievement(achievement, priorAchievements)),
      }; }),
      education: data.education.map((education) => {
        const prior = take(oldEducation, (item) => item.institution === education.institution && item.degree === education.degree && item.field === education.field);
        return {
        id: education.id ?? prior?.id ?? randomUUID(),
        institution: education.institution,
        degree: education.degree,
        field: education.field,
        startDate: education.startDate,
        endDate: education.endDate,
        details: education.details,
      }; }),
      updatedAt: now,
    };

    this.database
      .prepare(
        `INSERT INTO profiles (id, data_json, updated_at)
         VALUES ('primary', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(profile), now);
    return profile;
  }

  getProfile(): Profile | null {
    const row = this.database
      .prepare("SELECT data_json FROM profiles WHERE id = 'primary'")
      .get() as { data_json: string } | undefined;
    return row ? (JSON.parse(row.data_json) as Profile) : null;
  }

  createResumeImport(input: {
    originalFilename: string;
    mediaType: string;
    extractedText: string;
  }): ResumeImport {
    if (!input.originalFilename.trim() || !input.mediaType.trim() || !input.extractedText.trim()) {
      throw new Error("Resume import fields cannot be empty.");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO resume_imports
       (id, original_filename, media_type, extracted_text, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending_review')`,
    ).run(id, input.originalFilename, input.mediaType, input.extractedText, createdAt);
    return this.getResumeImport(id)!;
  }

  getResumeImport(id: string): ResumeImport | null {
    const row = this.database.prepare("SELECT * FROM resume_imports WHERE id = ?").get(id) as ResumeImportRow | undefined;
    return row ? mapResumeImport(row) : null;
  }

  getLatestResumeImport(): ResumeImport | null {
    const row = this.database.prepare("SELECT * FROM resume_imports ORDER BY sequence DESC LIMIT 1").get() as ResumeImportRow | undefined;
    return row ? mapResumeImport(row) : null;
  }

  createResumeVersion(jobId: string, plan: TailoringPlan): ResumeVersion {
    const job = this.getJob(jobId);
    if (!job) throw new Error("Cannot create a resume version for a missing job.");
    if (plan.jobId !== jobId) throw new Error("Tailoring plan job does not match.");

    const count = this.database
      .prepare("SELECT COUNT(*) AS count FROM resume_versions WHERE job_id = ?")
      .get(jobId) as { count: number };
    const now = new Date().toISOString();
    const version: ResumeVersion = {
      ...plan,
      id: randomUUID(),
      name: `${job.company} · ${job.title} · v${count.count + 1}`,
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(
        `INSERT INTO resume_versions (
          id, job_id, name, mode, plan_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        jobId,
        version.name,
        version.mode,
        JSON.stringify(version),
        version.createdAt,
        version.updatedAt,
      );
    return version;
  }

  getLatestResumeVersion(jobId: string): ResumeVersion | null {
    const row = this.database
      .prepare(
        `SELECT plan_json FROM resume_versions
         WHERE job_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(jobId) as { plan_json: string } | undefined;
    return row ? (JSON.parse(row.plan_json) as ResumeVersion) : null;
  }

  getResumeVersion(id: string): ResumeVersion | null {
    const row = this.database
      .prepare("SELECT plan_json FROM resume_versions WHERE id = ?")
      .get(id) as { plan_json: string } | undefined;
    return row ? (JSON.parse(row.plan_json) as ResumeVersion) : null;
  }

  updateSuggestionStatusForJob(
    jobId: string,
    versionId: string,
    suggestionId: string,
    status: TailoringSuggestion["status"],
  ): ResumeVersion | null {
    const owner = this.database
      .prepare("SELECT job_id FROM resume_versions WHERE id = ?")
      .get(versionId) as { job_id: string } | undefined;
    if (!owner || owner.job_id !== jobId) return null;
    return this.updateSuggestionStatus(versionId, suggestionId, status);
  }

  updateSuggestionStatus(
    versionId: string,
    suggestionId: string,
    status: TailoringSuggestion["status"],
  ): ResumeVersion | null {
    if (!(["pending", "accepted", "rejected"] as const).includes(status)) {
      throw new Error("Invalid suggestion status.");
    }
    const row = this.database
      .prepare("SELECT plan_json FROM resume_versions WHERE id = ?")
      .get(versionId) as { plan_json: string } | undefined;
    if (!row) return null;

    const version = JSON.parse(row.plan_json) as ResumeVersion;
    let found = false;
    version.suggestions = version.suggestions.map((suggestion) => {
      if (suggestion.id !== suggestionId) return suggestion;
      found = true;
      return { ...suggestion, status };
    });
    if (!found) return null;

    version.updatedAt = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE resume_versions SET plan_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(version), version.updatedAt, versionId);
    return version;
  }

  upsertAiConnection(input: {
    identity: string;
    provider: "openai-codex";
    credentialCiphertext: string;
    model: string;
    expiresAt: string;
    status: AiConnection["status"];
  }): AiConnection {
    const identity = canonicalizeIdentity(input.identity);
    if (!identity || !input.credentialCiphertext || !input.model.trim()) {
      throw new Error("AI connection fields cannot be empty.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO ai_connections (
        identity, provider, credential_ciphertext, model, expires_at,
        status, connected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity) DO UPDATE SET
        provider = excluded.provider,
        credential_ciphertext = excluded.credential_ciphertext,
        model = excluded.model,
        expires_at = excluded.expires_at,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    ).run(
      identity,
      input.provider,
      input.credentialCiphertext,
      input.model.trim(),
      input.expiresAt,
      input.status,
      now,
      now,
    );
    return this.getAiConnection(identity)!;
  }

  getAiConnection(identity: string): AiConnection | null {
    const row = this.database.prepare(
      "SELECT * FROM ai_connections WHERE identity = ?",
    ).get(canonicalizeIdentity(identity)) as AiConnectionRow | undefined;
    return row ? mapAiConnection(row) : null;
  }

  updateAiConnectionModel(identity: string, model: string): AiConnection | null {
    if (!model.trim()) throw new Error("Model cannot be empty.");
    const result = this.database.prepare(
      "UPDATE ai_connections SET model = ?, updated_at = ? WHERE identity = ?",
    ).run(model.trim(), new Date().toISOString(), canonicalizeIdentity(identity));
    return result.changes ? this.getAiConnection(identity) : null;
  }

  deleteAiConnection(identity: string): boolean {
    return this.database.prepare(
      "DELETE FROM ai_connections WHERE identity = ?",
    ).run(canonicalizeIdentity(identity)).changes > 0;
  }

  deleteAiConnectionAndDeviceFlows(identity: string): boolean {
    const owner = canonicalizeIdentity(identity);
    const disconnect = this.database.transaction(() => {
      const deleted = this.database.prepare(
        "DELETE FROM ai_connections WHERE identity = ?",
      ).run(owner);
      this.database.prepare(
        "DELETE FROM ai_device_flows WHERE identity = ?",
      ).run(owner);
      return deleted.changes > 0;
    });
    return disconnect();
  }

  createAiDeviceFlow(input: {
    id: string;
    identity: string;
    provider: "openai-codex";
    stateCiphertext: string;
    expiresAt: string;
  }): AiDeviceFlow {
    const identity = canonicalizeIdentity(input.identity);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id) ||
      !identity || !input.stateCiphertext
    ) {
      throw new Error("AI device flow fields cannot be empty or invalid.");
    }
    const id = input.id;
    const createdAt = new Date().toISOString();
    const create = this.database.transaction(() => {
      this.database.prepare(
        "DELETE FROM ai_device_flows WHERE identity = ?",
      ).run(identity);
      this.database.prepare(
        `INSERT INTO ai_device_flows (
          id, identity, provider, state_ciphertext, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        identity,
        input.provider,
        input.stateCiphertext,
        input.expiresAt,
        createdAt,
      );
    });
    create();
    return this.getAiDeviceFlow(id, identity)!;
  }

  getAiDeviceFlow(id: string, identity: string): AiDeviceFlow | null {
    const row = this.database.prepare(
      "SELECT * FROM ai_device_flows WHERE id = ? AND identity = ?",
    ).get(id, canonicalizeIdentity(identity)) as AiDeviceFlowRow | undefined;
    return row ? mapAiDeviceFlow(row) : null;
  }

  updateAiDeviceFlowState(
    id: string,
    identity: string,
    stateCiphertext: string,
  ): AiDeviceFlow | null {
    if (!stateCiphertext) throw new Error("AI device flow state cannot be empty.");
    const owner = canonicalizeIdentity(identity);
    const result = this.database.prepare(
      "UPDATE ai_device_flows SET state_ciphertext = ? WHERE id = ? AND identity = ?",
    ).run(stateCiphertext, id, owner);
    return result.changes ? this.getAiDeviceFlow(id, owner) : null;
  }

  consumeAiDeviceFlowAndUpsertConnection(input: {
    flowId: string;
    identity: string;
    expectedStateCiphertext: string;
    connection: {
      provider: "openai-codex";
      credentialCiphertext: string;
      model: string;
      expiresAt: string;
      status: AiConnection["status"];
    };
  }): AiConnection | null {
    const owner = canonicalizeIdentity(input.identity);
    if (!owner || !input.expectedStateCiphertext) {
      throw new Error("AI device flow completion fields cannot be empty.");
    }
    const complete = this.database.transaction(() => {
      const consumed = this.database.prepare(
        `DELETE FROM ai_device_flows
         WHERE id = ? AND identity = ? AND state_ciphertext = ?`,
      ).run(input.flowId, owner, input.expectedStateCiphertext);
      if (consumed.changes !== 1) return null;
      return this.upsertAiConnection({
        identity: owner,
        ...input.connection,
      });
    });
    return complete();
  }

  deleteAiDeviceFlow(id: string, identity: string): boolean {
    return this.database.prepare(
      "DELETE FROM ai_device_flows WHERE id = ? AND identity = ?",
    ).run(id, canonicalizeIdentity(identity)).changes > 0;
  }

  close(): void {
    this.database.close();
  }
}
