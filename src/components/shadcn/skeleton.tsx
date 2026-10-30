import { cn } from "@/lib/utils";

/**
 * `bg-line`, not the registry's `bg-accent`: `--color-accent` here is the violet
 * ranking wash, so an unadapted skeleton pulsed bright purple.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-line", className)}
      {...props}
    />
  );
}

export { Skeleton };
