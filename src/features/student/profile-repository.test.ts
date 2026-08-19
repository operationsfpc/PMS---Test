import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import {
  createSupabaseStudentCertificates,
  createSupabaseStudentProfileRepository,
} from "./profile-repository";

/**
 * Certificates added after the registration form was approved (2026-08-06).
 *
 * The SRF has collected them since F17, but the form locks on approval and a
 * certificate earned in the final semester had nowhere to go. The order is the
 * same as the SRF's, for the same reason: storage → document row →
 * certificate row. An object with no row is invisible and costs a few
 * kilobytes; a row with no object asks a coordinator to verify a claim against
 * a document that is not there.
 */
const BASE = "https://project.supabase.co";

function stub(opts: { uploadFails?: boolean; duplicate?: boolean } = {}) {
  const writes: Array<{ table: string; body: Record<string, unknown> }> = [];
  const uploads: string[] = [];
  const deletes: string[] = [];

  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  client.storage.from = ((bucket: string) => ({
    upload: async (path: string) => {
      uploads.push(`${bucket}/${path}`);
      return opts.uploadFails === true
        ? { data: null, error: new Error("network") }
        : { data: { path }, error: null };
    },
    createSignedUrl: async (path: string) => ({
      data: { signedUrl: `${BASE}/signed/${path}` },
      error: null,
    }),
  })) as unknown as typeof client.storage.from;

  server.use(
    http.get(`${BASE}/rest/v1/student_certificates`, () =>
      HttpResponse.json([
        {
          id: "cert-1",
          name: "AWS Cloud Practitioner",
          student_documents: { storage_path: "student-1/certificate-1-aws.pdf" },
        },
        { id: "cert-2", name: "NPTEL", student_documents: null },
      ]),
    ),
    http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
      writes.push({
        table: "student_documents",
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ id: "doc-9" });
    }),
    http.post(`${BASE}/rest/v1/student_certificates`, async ({ request }) => {
      writes.push({
        table: "student_certificates",
        body: (await request.json()) as Record<string, unknown>,
      });
      return opts.duplicate === true
        ? HttpResponse.json({ message: "duplicate key", code: "23505" }, { status: 409 })
        : HttpResponse.json({ id: "cert-3" });
    }),
    http.delete(`${BASE}/rest/v1/student_certificates`, ({ request }) => {
      deletes.push(new URL(request.url).search);
      return HttpResponse.json([]);
    }),
  );

  return { client, writes, uploads, deletes };
}

const repo = (client: ReturnType<typeof stub>["client"], studentId: string | null = "student-1") =>
  createSupabaseStudentCertificates(client, async () => studentId);

const pdf = () => new File(["scan"], "aws.pdf", { type: "application/pdf" });

describe("createSupabaseStudentCertificates", () => {
  it("reads back what the student has on file", async () => {
    const { client } = stub();

    const listed = await repo(client).list();

    expect(listed.map((c) => c.name)).toEqual(["AWS Cloud Practitioner", "NPTEL"]);
  });

  /** The bucket is private and a certificate carries the student's name. */
  it("signs the link rather than exposing a path", async () => {
    const { client } = stub();

    const listed = await repo(client).list();

    expect(listed[0]?.url).toBe(`${BASE}/signed/student-1/certificate-1-aws.pdf`);
  });

  it("says there is no link rather than rendering a dead one", async () => {
    const { client } = stub();

    expect((await repo(client).list())[1]?.url).toBeNull();
  });

  it("uploads under the student's own folder, which is what the policy checks", async () => {
    const { client, uploads } = stub();

    await repo(client).add("Azure Fundamentals", pdf());

    expect(uploads[0]).toMatch(/^marksheets\/student-1\/certificate-/);
  });

  it("records the document as a certificate, then names it", async () => {
    const { client, writes } = stub();

    await repo(client).add("  Azure Fundamentals  ", pdf());

    expect(writes[0]).toMatchObject({
      table: "student_documents",
      body: { student_id: "student-1", kind: "certificate" },
    });
    expect(writes[1]).toMatchObject({
      table: "student_certificates",
      // Trimmed: " AWS " and "AWS" are the same certificate to a human, and
      // 0034's index compares them that way too.
      body: { student_id: "student-1", name: "Azure Fundamentals", document_id: "doc-9" },
    });
  });

  it("writes nothing when the file cannot be uploaded", async () => {
    const { client, writes } = stub({ uploadFails: true });

    await expect(repo(client).add("Azure Fundamentals", pdf())).rejects.toThrow(/upload/i);
    expect(writes).toHaveLength(0);
  });

  /** F9, enforced by `one_certificate_per_name` where no screen can forget it. */
  it("says plainly when the same certificate is already on file", async () => {
    const { client } = stub({ duplicate: true });

    await expect(repo(client).add("AWS Cloud Practitioner", pdf())).rejects.toThrow(
      /already uploaded/i,
    );
  });

  it("removes one by id, scoped to the student who owns it", async () => {
    const { client, deletes } = stub();

    await repo(client).remove("cert-1");

    expect(deletes[0]).toMatch(/id=eq\.cert-1/);
    expect(deletes[0]).toMatch(/student_id=eq\.student-1/);
  });

  it("refuses to write for nobody", async () => {
    const { client } = stub();

    await expect(repo(client, null).add("Azure", pdf())).rejects.toThrow(/session/i);
    await expect(repo(client, null).remove("cert-1")).rejects.toThrow(/session/i);
    expect(await repo(client, null).list()).toEqual([]);
  });
});

/**
 * What a verified student may still edit (R10), read and written.
 *
 * `other_profiles` is jsonb: Postgres guarantees it is a list and nothing
 * more. A row written before 0025, or by hand, can hold anything at all - and
 * this runs on the screen a student reaches from their approved form, so a
 * crash here locks them out of the only part of their record that is theirs.
 */
function profileStub(row: Record<string, unknown>) {
  const patches: Array<Record<string, unknown>> = [];

  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  client.auth.getSession = (async () => ({
    data: { session: { user: { id: "auth-1" } } },
    error: null,
  })) as unknown as typeof client.auth.getSession;

  server.use(
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json(row)),
    http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
      patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: "student-1" });
    }),
  );

  return { repository: createSupabaseStudentProfileRepository(client), patches };
}

const VALUES = {
  driveTypePreferences: [] as const,
  technicalSkills: "TypeScript",
  areasOfInterest: "",
  areasOfExpertise: "",
  projects: "",
  achievements: "",
  linkedin: "",
  github: "",
  leetcode: "",
  hackerrank: "",
  otherProfiles: [],
};

describe("createSupabaseStudentProfileRepository", () => {
  it("reads back the other profiles the student added on the form", async () => {
    const { repository } = profileStub({
      technical_skills: "TypeScript",
      other_profiles: [{ label: "Kaggle", value: "asha_r" }],
    });

    const loaded = await repository.load();

    expect(loaded?.technicalSkills).toBe("TypeScript");
    expect(loaded?.otherProfiles).toEqual([{ label: "Kaggle", value: "asha_r" }]);
  });

  it("survives an other_profiles column holding something else entirely", async () => {
    const { repository } = profileStub({ other_profiles: "not a list" });

    expect((await repository.load())?.otherProfiles).toEqual([]);
  });

  it("drops a stored entry with neither half, rather than rendering a blank row", async () => {
    const { repository } = profileStub({ other_profiles: [{}, { label: "Kaggle" }] });

    expect((await repository.load())?.otherProfiles).toEqual([{ label: "Kaggle", value: "" }]);
  });

  it("stores an untouched field as NULL, never as an empty string", async () => {
    const { repository, patches } = profileStub({});

    await repository.save(VALUES);

    expect(patches[0]).toMatchObject({ technical_skills: "TypeScript", projects: null });
  });

  it("normalises the profile links it writes", async () => {
    const { repository, patches } = profileStub({});

    await repository.save({
      ...VALUES,
      otherProfiles: [
        { label: "  Kaggle ", value: " asha_r " },
        { label: "", value: "" },
      ],
    });

    expect(patches[0]?.other_profiles).toEqual([{ label: "Kaggle", value: "asha_r" }]);
  });

  /**
   * F9/F17: free text could be neither verified nor de-duplicated, so 0035
   * stopped writing it. This was the only other writer there was.
   */
  it("never writes the superseded certifications column", async () => {
    const { repository, patches } = profileStub({});

    await repository.save(VALUES);

    expect(Object.keys(patches[0] ?? {})).not.toContain("certifications");
  });

  it("says so when the save is refused", async () => {
    const { repository } = profileStub({});
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json({ message: "denied", code: "42501" }, { status: 403 }),
      ),
    );

    await expect(repository.save(VALUES)).rejects.toThrow(/could not save/i);
  });
});
