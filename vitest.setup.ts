import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./src/mocks/node";

// The UI is developed against the MSW contract, so tests run against it too.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
