import { delay, HttpResponse, http } from "msw";

/**
 * The API contract the UI is built against.
 * Layer 2 replaces these handlers with Supabase; the shapes stay identical.
 */
export const handlers = [
  http.post("/api/srf", async ({ request }) => {
    const body = (await request.json()) as { rollNumber?: string };
    await delay(400);

    // A roll number already claimed by another account is the one server-side
    // failure the student can actually hit.
    if (body.rollNumber === "TAKEN") {
      return HttpResponse.json(
        { error: "This roll number has already been registered." },
        { status: 409 },
      );
    }

    return HttpResponse.json({ id: "srf_01", status: "srf_submitted" }, { status: 201 });
  }),
];
