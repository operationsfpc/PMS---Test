// @vitest-environment jsdom
import { render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CertificateQueue } from "./certificate-queue";
import type {
  CertificateQueueRepository,
  PendingCertificate,
} from "./certificate-queue-repository";

/** Each row now links to the student's record, so the screen needs a router. */
const render = (ui: React.ReactElement) => renderRaw(<MemoryRouter>{ui}</MemoryRouter>);

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
  studentId: "s1",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  college: "PSG College of Technology",
  name: "AWS Cloud Practitioner",
  fileName: "aws.pdf",
  uploadedAt: "2026-08-06T10:00:00Z",
  url: "/signed/aws.pdf",
};

const AZURE: PendingCertificate = {
  id: "c2",
  studentId: "s2",
  studentName: "Arjun Menon",
  rollNumber: "21CSE9001",
  college: null,
  name: "Azure Fundamentals",
  fileName: null,
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

  /**
   * The queues run across every campus, so the college is what tells two
   * students apart once their names are on the same screen.
   */
  it("names the college the student belongs to", async () => {
    render(<CertificateQueue repository={repo()} />);

    const row = await rowFor("AWS Cloud Practitioner");
    expect(within(row).getByText(/PSG College of Technology/i)).toBeDefined();
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

  /**
   * 2026-10-17: a decision used to leave nothing but one fewer card, which a
   * coordinator reads as the click having done nothing at all.
   */
  it("says which certificate the last decision settled", async () => {
    const user = userEvent.setup();
    render(<CertificateQueue repository={repo()} />);

    const row = await rowFor("AWS Cloud Practitioner");
    await user.click(within(row).getByRole("button", { name: /verify/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/AWS Cloud Practitioner/i);
    expect(status.textContent).toMatch(/priya ramesh/i);
    expect(status.textContent).toMatch(/is verified/i);
  });

  /**
   * 2026-10-18: this refusal used to arrive only after the click, as an alert
   * above a row that looked ready to decide. Reject is locked while the reason
   * is blank — the label above the field already says what is required.
   */
  it("locks Reject until a reason is written", async () => {
    const decide = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<CertificateQueue repository={repo({ decide })} />);

    const row = await rowFor("AWS Cloud Practitioner");
    const reject = within(row).getByRole("button", { name: /reject/i }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);

    await user.type(within(row).getByLabelText(/reason/i), "The document is a screenshot");
    expect(reject.disabled).toBe(false);

    await user.click(reject);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  });

  /** Verify beside "no document" was a signature on the student's own typing. */
  it("refuses to verify a certificate with no document behind it", async () => {
    render(<CertificateQueue repository={repo()} />);

    const row = await rowFor("Azure Fundamentals");
    expect(
      (within(row).getByRole("button", { name: /verify/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
