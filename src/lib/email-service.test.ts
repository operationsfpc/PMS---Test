import { describe, expect, it, vi } from "vitest";
import { ResendEmailProvider } from "./email-service";

/** Email dispatch reads only `ok`, `status` and `json()` off the Resend response. */
function responseStub(body: Record<string, unknown>, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("ResendEmailProvider", () => {
  it("sends a single email through Resend API", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(responseStub({ id: "msg_12345" }));

    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      from: "onboarding@resend.dev",
      fetchFn: mockFetch,
    });

    const result = await provider.send({
      to: "student@example.com",
      subject: "Drive Update",
      text: "Round 1 is scheduled.",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("msg_12345");
    expect(result.recipient).toBe("student@example.com");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
        }),
      }),
    );
  });

  it("redirects recipient to thanush@faceprep.in when overrideRecipient is set", async () => {
    let requestBody: { to: string[]; text: string } | undefined;
    const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return responseStub({ id: "msg_overridden" });
    });

    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      overrideRecipient: "thanush@faceprep.in",
      fetchFn: mockFetch,
    });

    const result = await provider.send({
      to: "original_student@college.edu",
      subject: "Offer Letter",
      text: "Congratulations!",
    });

    expect(result.success).toBe(true);
    expect(result.recipient).toBe("thanush@faceprep.in");
    expect(requestBody?.to).toEqual(["thanush@faceprep.in"]);
    expect(requestBody?.text).toContain("original_student@college.edu");
  });

  it("handles Resend API error responses cleanly", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseStub({ message: "Domain not verified" }, false, 422));

    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      fetchFn: mockFetch,
    });

    const result = await provider.send({
      to: "student@example.com",
      subject: "Test",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Domain not verified");
  });

  it("sends batch emails in chunks adhering to batch limits", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseStub({ data: [{ id: "b_1" }, { id: "b_2" }] }));

    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      overrideRecipient: "thanush@faceprep.in",
      fetchFn: mockFetch,
    });

    const results = await provider.sendBatch([
      { to: "s1@example.com", subject: "S1" },
      { to: "s2@example.com", subject: "S2" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.recipient).toBe("thanush@faceprep.in");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails/batch",
      expect.anything(),
    );
  });
});
