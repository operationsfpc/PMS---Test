import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";
import loaderData from "../../public/loader.json";

export interface LottieLoaderProps {
  /** Size variant of the animation */
  readonly size?: "xs" | "sm" | "md" | "lg" | "fullscreen";
  /** Whether to take over the entire screen, obscuring sidebar, header, etc. */
  readonly fullscreen?: boolean;
  /** Optional loading message displayed beneath the animation */
  readonly message?: string;
  /** Additional container classes */
  readonly className?: string;
}

const SIZES = {
  xs: "size-10",
  sm: "size-16 sm:size-20",
  md: "size-28 sm:size-36",
  lg: "size-40 sm:size-48",
  fullscreen: "size-40 sm:size-48",
} as const;

/**
 * Brand-themed Lottie animation loader for FACE Prep Campus.
 * Features a bright Tweety canary yellow (#ffeb00) character reading a book.
 */
export function LottieLoader({
  size = "md",
  fullscreen = false,
  message,
  className = "",
}: LottieLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  const isFullscreen = fullscreen || size === "fullscreen";

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;

    let isMounted = true;
    import("lottie-web/build/player/lottie_light")
      .then((mod) => {
        if (!isMounted || !containerRef.current) return;
        const lottieInstance = mod.default ?? mod;
        try {
          animRef.current = lottieInstance.loadAnimation({
            container: containerRef.current,
            renderer: "svg",
            loop: true,
            autoplay: true,
            animationData: loaderData,
          });
        } catch {
          // Gracefully handle environments without full SVG animation support (e.g. unit tests)
        }
      })
      .catch(() => {
        // Fallback gracefully if dynamic import fails
      });

    return () => {
      isMounted = false;
      try {
        animRef.current?.destroy();
      } catch {
        // no-op
      }
      animRef.current = null;
    };
  }, []);

  const sizeClass = SIZES[size] ?? SIZES.md;

  const content = (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center p-4 text-center ${className}`}
    >
      <div
        ref={containerRef}
        className={`${sizeClass} shrink-0 transition-transform duration-300`}
        aria-hidden="true"
      />
      {message && (
        <p className="mt-4 font-semibold text-sm sm:text-base text-ink-800 tracking-wide">
          {message}
        </p>
      )}
      <span className="sr-only">{message ?? "Loading…"}</span>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[100] flex min-h-dvh w-screen flex-col items-center justify-center bg-surface-muted p-6">
        {content}
      </div>
    );
  }

  return content;
}
