// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonAnchor, ButtonLink } from "./ui";

/**
 * The one control every role's screens press.
 *
 * Its contract is that a press in flight is a press that cannot happen: a
 * double click on a declaration, a shortlist or a PIF is the duplicate row a
 * coordinator then has to find and delete.
 */
describe("Button", () => {
  it("holds the press still while it is in flight, and says so to a reader", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Declare selected
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Declare selected" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("cannot be re-enabled by a caller that passes its own state gate", () => {
    // `disabled={closed !== null}` is a STATE rule and `isLoading` is a
    // DOUBLE-PRESS rule. Read together with `??` the first switched the second
    // off, so a gated button became clickable again the moment it spun.
    render(
      <Button isLoading disabled={false}>
        Declare selected
      </Button>,
    );

    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("stays enabled when neither rule applies", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Declare selected</Button>);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * The other half of the vocabulary: a card's `View` opens something, so it is a
 * link, and 2026-10-18's report was that drawn as blue underlined prose nobody
 * read as a control. These are the two halves of the same promise — it still
 * behaves like a link, and it no longer looks like one.
 */
describe("ButtonLink", () => {
  /** A card's View, mounted where its `to=` can actually be followed. */
  const renderLink = (ui: ReactNode) =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/drives/d1" element={<p>Accenture drive record</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it("keeps every affordance of a link while wearing the primary button's shape", () => {
    renderLink(
      <ButtonLink to="/drives/d1" aria-label="View Accenture — Jr. Software Engineer">
        View
      </ButtonLink>,
    );

    const view = screen.getByRole("link", { name: "View Accenture — Jr. Software Engineer" });
    expect(view.getAttribute("href")).toBe("/drives/d1");
    expect(view.className).toContain("bg-brand-500");
    // The whole complaint, in one assertion: a link's underline is prose.
    expect(view.className).not.toContain("underline");
  });

  it("is the same height as the Button beside it", () => {
    // Two controls on one card, one a press and one a navigation, that stop
    // matching the moment somebody edits only one of the two class strings.
    renderLink(
      <>
        <Button size="sm">Approve</Button>
        <ButtonLink size="sm" to="/drives/d1">
          View
        </ButtonLink>
        <ButtonLink to="/drives/d1">View</ButtonLink>
      </>,
    );

    const press = screen.getByRole("button", { name: "Approve" });
    const [small, large] = screen.getAllByRole("link");
    expect(small?.className).toContain("px-3 py-1.5 text-xs");
    expect(press.className).toContain("px-3 py-1.5 text-xs");
    expect(large?.className).toContain("px-4 py-2.5 text-sm");
  });

  it("takes the quiet variant like the Button does", () => {
    renderLink(
      <ButtonLink variant="ghost" to="/drives/d1">
        View
      </ButtonLink>,
    );

    const view = screen.getByRole("link", { name: "View" });
    expect(view.className).toContain("bg-brand-50");
    expect(view.getAttribute("href")).toBe("/drives/d1");
  });

  it("actually goes where the card says it goes", async () => {
    const user = userEvent.setup();
    renderLink(<ButtonLink to="/drives/d1">View</ButtonLink>);

    await user.click(screen.getByRole("link", { name: "View" }));
    expect(await screen.findByText("Accenture drive record")).toBeDefined();
  });
});

/**
 * The row's second affordance: a file the browser takes away. It is a control
 * like the View beside it, and named by its object, because two identical
 * "View" words on one row leaves the reader to guess which is the person.
 */
describe("ButtonAnchor", () => {
  it("stays a real document link and drops the underline", () => {
    render(
      <ButtonAnchor href="https://storage/certificate.pdf" target="_blank" rel="noopener">
        Certificate
      </ButtonAnchor>,
    );

    const file = screen.getByRole("link", { name: "Certificate" });
    expect(file.getAttribute("href")).toBe("https://storage/certificate.pdf");
    expect(file.getAttribute("target")).toBe("_blank");
    expect(file.className).not.toContain("underline");
    // Quieter than the row's View by default, so the record stays the headline.
    expect(file.className).toContain("bg-surface");
  });
});
