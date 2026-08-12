// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CertificateQueue } from "./certificate-queue";
import type {
  CertificateQueueRepository,
  PendingCertificate,
} from "./certificate-queue-repository";

/**
 * The coordinator's certificate queue (asked for 2026-08-06).
 *
 * "skill certifications uploaded by students will also need verification of
 * campus placement coordinator similar to CGPA approval."
 *
 * The screen's whole job is to put the certificate's NAME beside the DOCUMENT
 * it claims, so the coordinator can compare them. A verify button with no
 * link to open would be a signature on the student's own typing.
 */
const AWS: PendingCertificate = {
  id: "c1",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  name: "AWS Cloud Practitioner",
  uploadedAt: "2026-08-06T10:00:00Z",
  url: "/signed/aws.pdf",
};

const AZURE: PendingCertificate = {
  id: "c2",
  studentName: "Arjun Menon",
  rollNumber: "21CSE9001",
  name: "Azure Fundamentals",
  uploadedAt: "2026-08-06T11:00:00Z",
  url: null,
};

function repo(overrides: Partial<CertificateQueueRepository> = {}): CertificateQueueRepository {
  return {
    pending: async () => [AWS, AZURE],
    decide: async () => undefined,
    ...overrides,
  };
}

const rowFor = async (name: string) => {
  const cell = await screen.findByText(name);
  const row = cell.closest("li");
  if (row === null) throw new Error(`row for ${name} not found`);
  return row;
};

describe("CertificateQueue", () => {
  it("names the student, the certificate and links to the document", async () => {
    render(<CertificateQueue repository={repo()} />);

    const row = await rowFor("AWS Cloud Practitioner");
    expect(within(row).getByText(/priya ramesh/i)).toBeDefined();
    expect(within(row).getByText(/21CSE1042/)).toBeDefined();
    expect(
      within(row).getByRole<HTMLAnchorElement>("link", { name: /open certificate/i }).href,
    ).toContain("/signed/aws.pdf");
  });

  /** A coordinator must never think they checked something they could not open. */
  it("says so when there is no document to check, rather than offering a dead link", async () => {
    render(<CertificateQueue repository={repo()} />);

    const row = await rowFor("Azure Fundamentals");
    expect(within(row).queryByRole("link", { name: /open certificate/i })).toBeNull();
    expect(within(row).getByText(/no document/i)).toBeDefined();
  });

  it("verifies one and reloads the queue", async () => {
    const decide = vi.fn(async () => undefined);
    const pending = vi
      .fn<CertificateQueueRepository["pending"]>()
      .mockResolvedValueOnce([AWS, AZURE])
      .mockResolvedValue([AZURE]);
    const user = userEvent.setup();
    render(<CertificateQueue repository={repo({ decide, pending })} />);

    const row = await rowFor("AWS Cloud Practitioner");
    await user.click(within(row).getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("c1", "pending", { decision: "verify" }),
    );
    await waitFor(() => expect(screen.queryByText("AWS Cloud Practitioner")).toBeNull());
  });

  it("rejects one with a reason", async () => {
    const decide = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<CertificateQueue repository={repo({ decide })} />);

    const row = await rowFor("AWS Cloud Practitioner");
    await user.type(within(row).getByLabelText(/reason/i), "The document is a screenshot");
    await user.click(within(row).getByRole("button", { name: /reject/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("c1", "pending", {
        decision: "reject",
        reason: "The document is a screenshot",
      }),
    );
  });

  it("reports the domain's refusal when a rejection has no reason", async () => {
    const decide = vi.fn(async () => {
      throw new Error("A rejection needs a reason, so the student knows what to correct.");
    });
    const user = userEvent.setup();
    render(<CertificateQueue repository={repo({ decide })} />);

    const row = await rowFor("AWS Cloud Practitioner");
    await user.click(within(row).getByRole("button", { name: /reject/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("needs a reason"),
    );
  });

  it("says the queue is empty when nothing is waiting", async () => {
    render(<CertificateQueue repository={repo({ pending: async () => [] })} />);

    expect(await screen.findByText(/no certificates are waiting/i)).toBeDefined();
  });

  /** An empty queue and a failed load mean opposite things to a coordinator. */
  it("does not show a failed load as an empty queue", async () => {
    render(
      <CertificateQueue
        repository={repo({
          pending: async () => {
            throw new Error("boom");
          },
        })}
      />,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/no certificates are waiting/i)).toBeNull();
  });
});
