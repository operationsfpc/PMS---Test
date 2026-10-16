// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsyncAction } from "./use-async-action";

/**
 * The hook is the only thing between a coordinator and a double submit, so the
 * tests are about the two ways it can fail: a spinner that follows the wrong
 * row, and a refusal that silently swallows the reason.
 */
describe("useAsyncAction", () => {
  it("keys pending state per row, so one row's spinner does not light up its neighbour", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { result } = renderHook(() => useAsyncAction());

    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = result.current.run(() => gate, "drive-1");
    });

    expect(result.current.isPending("drive-1")).toBe(true);
    expect(result.current.isPending("drive-2")).toBe(false);
    expect(result.current.busy).toBe(true);

    // The same row refuses a second write while the first is still out.
    const refused = await result.current.run(() => Promise.resolve(), "drive-1");
    expect(refused).toBe(false);

    await act(async () => {
      release();
      expect(await first).toBe(true);
    });

    expect(result.current.isPending("drive-1")).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it("keeps the sentence the view wrote, which is the one that names the problem", async () => {
    const { result } = renderHook(() => useAsyncAction());

    const ok = await act(async () =>
      result.current.run(() =>
        Promise.reject(new Error("The venue date has already passed. Pick a later one.")),
      ),
    );

    expect(ok).toBe(false);
    expect(result.current.error).toBe("The venue date has already passed. Pick a later one.");
  });

  it("clears the old failure the moment a new attempt starts", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("Network is unreachable.")));
    });
    expect(result.current.error).toBe("Network is unreachable.");

    let release = () => {};
    await act(async () => {
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      void result.current.run(() => gate, "publish");
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.isPending("publish")).toBe(true);
    });

    await act(async () => {
      release();
    });
  });

  it("says something usable when the cause is not an Error", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject("boom"));
    });

    expect(result.current.error).toBe("That didn’t go through. Please try again.");
  });

  it("lets the caller dismiss a failure it has already shown", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("Signed in elsewhere.")));
    });

    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });
});
