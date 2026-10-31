// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Badge, Button, ButtonAnchor, ButtonLink, Card, StatCard } from "./ui";

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

/**
 * The fill a card is allowed to have.
 *
 * The tints existed as forty hand-typed `bg-*-50` strings, which is how two
 * cards describing the same state ended up two different ambers — and a panel
 * that took a background from the primitive AND from its caller resolves by CSS
 * source order, so nobody reading the code could say what colour it was.
 */
describe("Card", () => {
  const FILLS = {
    surface: "bg-surface",
    quiet: "bg-surface-muted",
    brand: "bg-brand-50",
    warn: "bg-gold-50",
    good: "bg-success-50",
  } as const;

  /** Every background utility on the element, in the order they were written. */
  const painted = (el: HTMLElement) => el.className.split(/\s+/).filter((c) => c.startsWith("bg-"));

  it("paints exactly one background for every tone", () => {
    for (const tone of Object.keys(FILLS) as (keyof typeof FILLS)[]) {
      render(<Card tone={tone}>{tone} panel</Card>);
    }

    for (const tone of Object.keys(FILLS) as (keyof typeof FILLS)[]) {
      expect(painted(screen.getByText(`${tone} panel`)), `tone=${tone}`).toEqual([FILLS[tone]]);
    }
  });

  it("is the plain surface panel when no tone is asked for", () => {
    render(<Card>Drive record</Card>);
    expect(painted(screen.getByText("Drive record"))).toEqual(["bg-surface"]);
  });

  it("passes the caller's spacing through without swallowing it", () => {
    render(
      <Card tone="warn" className="p-5">
        Two coordinators, one note
      </Card>,
    );

    const card = screen.getByText("Two coordinators, one note");
    expect(card.className).toContain("p-5");
    expect(card.className).toContain("rounded-card");
    expect(painted(card)).toEqual(["bg-gold-50"]);
  });
});

/**
 * The same word with the pill taken off.
 *
 * A table cell that says `Paid` inside a rounded amber chip pulls the eye off
 * the row's own name. The colour still carries the meaning; the shape stops
 * competing with the data it sits beside.
 */
describe("Badge", () => {
  const TEXT_TONES = {
    neutral: "text-ink-700",
    brand: "text-brand-700",
    accent: "text-violet-700",
    success: "text-success-700",
    warning: "text-gold-800",
    danger: "text-danger-700",
  } as const;

  it("keeps the pill, the fill and the border it has always had", () => {
    render(<Badge tone="success">Paid</Badge>);

    const pill = screen.getByText("Paid");
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("border");
    expect(pill.className).toContain("bg-success-50");
  });

  it("takes the caller's layout and still owns the colour", () => {
    render(
      <Badge tone="warning" className="ml-auto">
        Needs a date
      </Badge>,
    );

    const pill = screen.getByText("Needs a date");
    expect(pill.className).toContain("ml-auto");
    expect(pill.className).toContain("bg-gold-50");
  });

  it("keeps every tone's colour when the pill is off", () => {
    for (const tone of Object.keys(TEXT_TONES) as (keyof typeof TEXT_TONES)[]) {
      render(
        <Badge variant="text" tone={tone}>
          {tone} state
        </Badge>,
      );
    }

    for (const tone of Object.keys(TEXT_TONES) as (keyof typeof TEXT_TONES)[]) {
      const text = screen.getByText(`${tone} state`);
      expect(text.className, `tone=${tone}`).toContain(TEXT_TONES[tone]);
      expect(text.className, `tone=${tone}`).not.toContain("rounded-full");
      expect(text.className, `tone=${tone}`).not.toContain("border");
      // The variant's whole point: no filled box behind the word.
      expect(
        text.className.split(/\s+/).some((c) => c.startsWith("bg-")),
        `tone=${tone}`,
      ).toBe(false);
    }
  });
});

/**
 * The number at the top of a page.
 *
 * Five bordered boxes competing for attention say nothing; five figures under
 * one quiet label say everything. The press that opens the people behind a
 * count has to survive the box being taken away, or the readout row becomes
 * decoration.
 */
describe("StatCard", () => {
  /** The component's own root, so the shell can be asserted without a query. */
  const root = (ui: ReactNode) => {
    const { container } = render(<MemoryRouter>{ui}</MemoryRouter>);
    return container.firstElementChild as HTMLElement;
  };

  it("reads as a figure, not a box", () => {
    const card = root(
      <StatCard variant="readout" label="Open drives" value={12} hint="across 4 campuses" />,
    );

    expect(card.className).not.toContain("border");
    expect(card.className).not.toContain("shadow");
    expect(screen.getByText("Open drives").className).not.toContain("uppercase");

    const figure = screen.getByText("12");
    expect(figure.className).toContain("text-readout");
    expect(figure.className).toContain("font-light");
    expect(figure.className).toContain("tabular-nums");
    expect(screen.getByText("across 4 campuses")).toBeDefined();
  });

  it("keeps the tinted tile when nothing is asked for", () => {
    const card = root(<StatCard label="Open drives" value={12} />);

    expect(card.className).toContain("border");
    expect(card.className).toContain("rounded-card");
    expect(screen.getByText("Open drives").className).toContain("uppercase");
    expect(screen.getByText("12").className).not.toContain("text-readout");
  });

  it("keeps the press once a readout opens the people behind the number", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const card = root(<StatCard variant="readout" label="On hold" value={4} onClick={onClick} />);

    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    expect(card.className).not.toContain("border");
    // The frame is gone, so the hover fill is the only thing saying clickable.
    expect(card.className).toContain("hover:bg-surface-muted");

    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText("See who")).toBeDefined();
  });

  it("navigates when the count leads to a page of its own", () => {
    const card = root(<StatCard variant="readout" label="Students" value={200} to="/students" />);

    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe("/students");
    expect(card.className).not.toContain("border");
  });
});
