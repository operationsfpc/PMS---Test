import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a <Tabs>");
  }
  return context;
}

export function Tabs({
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  children,
  className = "",
}: {
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const activeValue = isControlled ? controlledValue : uncontrolledValue;
  const baseId = useId();

  const onChange = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: activeValue, onChange, baseId }}>
      <div className={`w-full ${className}`}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`inline-flex items-center gap-1 rounded-xl bg-surface-muted p-1 border border-line ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  disabled = false,
  className = "",
}: {
  value: string;
  children: ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const { value: activeValue, onChange, baseId } = useTabsContext();
  const isSelected = activeValue === value;

  const triggerId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <button
      type="button"
      role="tab"
      id={triggerId}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50 ${
        isSelected
          ? "bg-surface text-brand-900 shadow-xs font-bold"
          : "text-ink-500 hover:text-ink-900 hover:bg-surface/50"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  const { value: activeValue, baseId } = useTabsContext();
  const isSelected = activeValue === value;

  const triggerId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={triggerId}
      className={`mt-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}
    >
      {children}
    </div>
  );
}
