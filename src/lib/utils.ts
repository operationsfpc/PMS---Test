import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** The merge shadcn components expect: conditional classes, then last-wins Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
