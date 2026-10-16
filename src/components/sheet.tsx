import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface SheetContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  titleId: string;
  descriptionId: string;
}

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext() {
  const context = useContext(SheetContext);
  if (!context) {
    throw new Error("Sheet components must be used within a <Sheet>");
  }
  return context;
}

export function Sheet({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const titleId = useId();
  const descriptionId = useId();

  const open = useCallback(() => {
    if (!isControlled) setUncontrolledOpen(true);
    onOpenChange?.(true);
  }, [isControlled, onOpenChange]);

  const close = useCallback(() => {
    if (!isControlled) setUncontrolledOpen(false);
    onOpenChange?.(false);
  }, [isControlled, onOpenChange]);

  return (
    <SheetContext.Provider value={{ isOpen, open, close, titleId, descriptionId }}>
      {children}
    </SheetContext.Provider>
  );
}

export function SheetTrigger({
  children,
  className = "",
  asChild = false,
}: {
  children: ReactNode;
  className?: string | undefined;
  asChild?: boolean | undefined;
}) {
  const { open } = useSheetContext();

  return (
    <button
      type="button"
      onClick={open}
      className={
        asChild
          ? `inline-block cursor-pointer bg-transparent border-0 p-0 text-left ${className}`
          : className
      }
    >
      {children}
    </button>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Body scrolling must stop while a drawer covers the page — and two drawers
 * opened in sequence must not leave it stuck off.
 */
let scrollLocks = 0;
function lockPageScroll(): () => void {
  scrollLocks += 1;
  document.body.style.overflow = "hidden";
  return () => {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = "";
  };
}

export function SheetContent({
  children,
  side = "right",
  className = "",
  size = "md",
}: {
  children: ReactNode;
  side?: "right" | "left" | "top" | "bottom" | undefined;
  className?: string | undefined;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "full" | undefined;
}) {
  const { isOpen, close, titleId, descriptionId } = useSheetContext();
  const contentRef = useRef<HTMLDivElement>(null);

  // Escape closes, Tab stays inside. A drawer that lets focus escape behind the
  // backdrop is a keyboard trap in reverse: the user is tabbing through a page
  // they cannot see.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || contentRef.current === null) return;

      const focusable = [...contentRef.current.querySelectorAll(FOCUSABLE)];
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || active === contentRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // Hand focus to the drawer, and give it back to whatever opened it.
  useEffect(() => {
    if (!isOpen) return;
    const openedBy = document.activeElement as HTMLElement | null;
    const target = contentRef.current;
    target?.focus();

    const unlock = lockPageScroll();
    return () => {
      unlock();
      openedBy?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sideClasses = {
    right: "inset-y-0 right-0 h-full border-l animate-slide-in-right",
    left: "inset-y-0 left-0 h-full border-r animate-slide-in-left",
    top: "inset-x-0 top-0 w-full border-b animate-slide-in-top",
    bottom: "inset-x-0 bottom-0 w-full border-t animate-slide-in-bottom",
  }[side];

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-xl",
    xl: "max-w-3xl",
    "2xl": "max-w-5xl",
    full: "max-w-full w-full",
  }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 animate-fade-in bg-ink-900/40 backdrop-blur-xs"
      />

      {/* Drawer Panel */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`relative z-50 flex h-full w-full flex-col border-line bg-surface p-6 shadow-2xl overflow-y-auto focus:outline-hidden ${sideClasses} ${sizeClasses} ${className}`}
      >
        <button
          type="button"
          aria-label="Close panel"
          onClick={close}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-ink-400 hover:bg-surface-muted hover:text-ink-700 transition-colors"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col space-y-1.5 text-left pb-4 border-b border-line mb-4 ${className}`}
      {...props}
    />
  );
}

export function SheetTitle({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useSheetContext();
  return (
    <h3
      id={titleId}
      className={`font-heading text-lg font-bold text-[#3D3777] ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
}

export function SheetDescription({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useSheetContext();
  return (
    <p
      id={descriptionId}
      className={`text-xs text-ink-500 leading-relaxed ${className}`}
      {...props}
    >
      {children}
    </p>
  );
}

export function SheetFooter({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mt-auto flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4 border-t border-line ${className}`}
      {...props}
    />
  );
}

export function SheetClose({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const { close } = useSheetContext();
  return (
    <button type="button" onClick={close} className={className}>
      {children}
    </button>
  );
}
