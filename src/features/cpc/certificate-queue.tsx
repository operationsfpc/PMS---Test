import { Card, PageHeader } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  CertificateQueueError,
  type CertificateQueueRepository,
  createSupabaseCertificateQueueRepository,
  type PendingCertificate,
} from "./certificate-queue-repository";

/**
 * The coordinator's certificate queue (asked for 2026-08-06).
 *
 * "skill certifications uploaded by students will also need verification of
 * campus placement coordinator similar to CGPA approval. This is applicable
 * for first upload as well as subsequent additions."
 *
 * The screen's whole job is to put the certificate's NAME beside the DOCUMENT
 * it claims, so the two can be compared. This is the same lesson as the
 * semester marksheets: before 0023 a coordinator saw a CGPA with nothing to
 * check it against, and "verified" meant endorsing the student's own typing.
 *
 * Every pending certificate is here regardless of how it arrived - with the
 * registration form or added months later from the profile page - because
 * "first upload as well as subsequent additions" is one rule, not two.
 */
export function CertificateQueue({ repository }: { repository?: CertificateQueueRepository }) {
  const [rows, setRows] = useState<readonly PendingCertificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // Created once: a new client on every render would refetch endlessly.
  const [repo] = useState<CertificateQueueRepository>(
    () => repository ?? createSupabaseCertificateQueueRepository(supabase()),
  );

  const load = useCallback(async () => {
    try {
      setRows(await repo.pending());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof CertificateQueueError
          ? caught.message
          : "Could not load the certificate queue.",
      );
      // Deliberately NOT []: an empty queue and a failed load mean opposite
      // things to a coordinator and must never look the same.
      setRows(null);
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(certificate: PendingCertificate, verify: boolean) {
    setBusyId(certificate.id);
    setError(null);
    try {
      await repo.decide(
        certificate.id,
        "pending",
        verify
          ? { decision: "verify" }
          : { decision: "reject", reason: reasons[certificate.id] ?? "" },
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the decision. Please try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Certificate verification"
        subtitle="Open each certificate and check it against the name the student gave it."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading the certificate queue…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No certificates are waiting to be verified.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((certificate) => (
            <li key={certificate.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-[Raleway] text-base font-bold text-ink-900">
                      {certificate.name}
                    </p>
                    {certificate.fileName !== null && (
                      <p className="text-xs text-ink-500 font-mono">({certificate.fileName})</p>
                    )}
                    <p className="mt-0.5 text-sm text-ink-700">{certificate.studentName}</p>
                    <p className="text-xs text-ink-500">{certificate.rollNumber}</p>
                  </div>

                  {certificate.url === null ? (
                    // Never a dead link: a coordinator must not believe they
                    // have checked something they could not open.
                    <p className="text-sm text-[#DD4820]">No document uploaded</p>
                  ) : (
                    <a
                      className="text-sm font-medium text-brand-600 underline"
                      href={certificate.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open certificate
                    </a>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`reason-${certificate.id}`}
                      className="mb-1 block text-sm font-medium text-ink-900"
                    >
                      Reason (required to reject)
                    </label>
                    <input
                      id={`reason-${certificate.id}`}
                      type="text"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                      placeholder="What the student needs to correct"
                      value={reasons[certificate.id] ?? ""}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [certificate.id]: e.target.value }))
                      }
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busyId === certificate.id}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                    onClick={() => void decide(certificate, true)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    disabled={busyId === certificate.id}
                    className="rounded-lg border border-[#DD4820] px-4 py-2 text-sm font-semibold text-[#DD4820] hover:bg-[#FFF0EC] disabled:opacity-50"
                    onClick={() => void decide(certificate, false)}
                  >
                    Reject
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
