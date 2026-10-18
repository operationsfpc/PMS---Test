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
import { Button } from "./ui";

interface AlertDialogContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  titleId: string;
  descriptionId: string;
}

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

function useAlertDialogContext() {
  const context = useContext(AlertDialogContext);
  if (!context) {
    throw new Error("AlertDialog components must be used within an <AlertDialog>");
  }
  return context;
}

export function AlertDialog({
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
    <AlertDialogContext.Provider value={{ isOpen, open, close, titleId, descriptionId }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

export function AlertDialogTrigger({
  children,
  className = "",
  asChild = false,
}: {
  children: ReactNode;
  className?: string | undefined;
  asChild?: boolean | undefined;
}) {
  const { open } = useAlertDialogContext();

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

export function AlertDialogContent({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const { isOpen, close, titleId, descriptionId } = useAlertDialogContext();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 bg-ink-900/50 backdrop-blur-xs transition-opacity animate-fade-in"
      />

      {/* Modal Card */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`relative z-50 my-auto w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-2xl animate-pop-in ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function AlertDialogHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex flex-col space-y-2 text-left mb-4 ${className}`} {...props} />;
}

export function AlertDialogTitle({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useAlertDialogContext();
  return (
    <h3
      id={titleId}
      className={`font-heading text-lg font-bold text-ink-900 ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
}

export function AlertDialogDescription({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useAlertDialogContext();
  return (
    <p
      id={descriptionId}
      className={`text-sm text-ink-600 leading-relaxed ${className}`}
      {...props}
    >
      {children}
    </p>
  );
}

export function AlertDialogFooter({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-line mt-4 ${className}`}
      {...props}
    />
  );
}

export function AlertDialogAction({
  children,
  variant = "primary",
  onClick,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "danger" | "secondary" | "gold" | undefined;
  onClick?: (() => void | Promise<void>) | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const { close } = useAlertDialogContext();

  const handleClick = async () => {
    if (onClick) {
      await onClick();
    }
    close();
  };

  return (
    <Button variant={variant} disabled={disabled} onClick={handleClick} className={className}>
      {children}
    </Button>
  );
}

export function AlertDialogCancel({
  children = "Cancel",
  className = "",
}: {
  children?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const { close } = useAlertDialogContext();
  return (
    <Button variant="secondary" onClick={close} className={className}>
      {children}
    </Button>
  );
}
