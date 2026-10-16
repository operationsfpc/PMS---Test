import { createContext, type ReactNode, useContext, useId, useState } from "react";

/**
 * The accordion every list on this platform was missing (UAT 2026-10-16:
 * "everywhere i need proper accordation"). One `<details>` in the cockpit and
 * a bespoke sidebar collapse were the whole inventory, so each new expandable
 * region re-invented the keyboard behaviour — and most got it wrong.
 *
 * Panels stay mounted and are hidden rather than unmounted. That is a
 * deliberate trade: a collapsed event keeps the search text typed into its
 * student table, at the cost of a heavier DOM.
 */

interface AccordionRootValue {
  isOpen(itemId: string): boolean;
  toggle(itemId: string): void;
}

const RootContext = createContext<AccordionRootValue | null>(null);

interface AccordionItemValue {
  itemId: string;
  open: boolean;
  toggle(): void;
  triggerId: string;
  panelId: string;
}

const ItemContext = createContext<AccordionItemValue | null>(null);

function useRoot(component: string): AccordionRootValue {
  const root = useContext(RootContext);
  if (root === null) {
    throw new Error(`<${component}> must be used inside an <Accordion>`);
  }
  return root;
}

function useItem(component: string): AccordionItemValue {
  const item = useContext(ItemContext);
  if (item === null) {
    throw new Error(`<${component}> must be used inside an <AccordionItem>`);
  }
  return item;
}

export function Accordion({
  children,
  className = "",
  multiple = false,
  value,
  defaultValue = [],
  onValueChange,
}: {
  children: ReactNode;
  className?: string | undefined;
  /** Allow more than one panel open at a time. */
  multiple?: boolean | undefined;
  value?: readonly string[] | undefined;
  defaultValue?: readonly string[] | undefined;
  onValueChange?: ((value: readonly string[]) => void) | undefined;
}) {
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState<readonly string[]>(defaultValue);
  const openIds = isControlled ? value : uncontrolled;

  const toggle = (itemId: string) => {
    const isOpen = openIds.includes(itemId);
    const next = isOpen
      ? openIds.filter((id) => id !== itemId)
      : multiple
        ? [...openIds, itemId]
        : [itemId];

    if (!isControlled) setUncontrolled(next);
    onValueChange?.(next);
  };

  return (
    <RootContext.Provider value={{ isOpen: (itemId) => openIds.includes(itemId), toggle }}>
      <div className={`flex flex-col ${className}`}>{children}</div>
    </RootContext.Provider>
  );
}

export function AccordionItem({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  const root = useRoot("AccordionItem");
  const uid = useId();
  const open = root.isOpen(value);

  return (
    <ItemContext.Provider
      value={{
        itemId: value,
        open,
        toggle: () => root.toggle(value),
        triggerId: `${uid}-trigger`,
        panelId: `${uid}-panel`,
      }}
    >
      <div className={`border-b border-line last:border-b-0 ${className}`}>{children}</div>
    </ItemContext.Provider>
  );
}

export function AccordionTrigger({
  children,
  className = "",
  iconAfter = true,
}: {
  children: ReactNode;
  className?: string | undefined;
  /** Turn off the chevron when the trigger already ends in its own affordance. */
  iconAfter?: boolean | undefined;
}) {
  const { open, toggle, triggerId, panelId } = useItem("AccordionTrigger");

  return (
    <h3 className="m-0">
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={`flex w-full cursor-pointer items-center justify-between gap-3 text-left transition-colors ${className}`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</span>
        {iconAfter && <Chevron open={open} />}
      </button>
    </h3>
  );
}

export function AccordionContent({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const { open, triggerId, panelId } = useItem("AccordionContent");

  return (
    <section
      id={panelId}
      aria-labelledby={triggerId}
      hidden={!open}
      className={open ? className : `hidden ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * A chevron that answers to an open state outside an accordion — for headers
 * that are already buttons and only need the moving part.
 */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
