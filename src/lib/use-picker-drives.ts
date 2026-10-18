import type { PickerDrive } from "@components/drive-picker";
import { useCallback, useEffect, useState } from "react";
import { fetchPickerDrives } from "./drive-picker-data";
import { supabase } from "./supabase";

/**
 * The drives a picker offers, with the three states a reader can act on.
 *
 * 2026-10-18: four screens — Shortlisting, Rounds & results, Attendance and
 * Final selection — read `void fetchPickerDrives(...).then(setDrives)`. A
 * rejected fetch left `drives` null for good, so the page sat on "Loading
 * drives…" forever and nobody was told the query had failed. Choosing a drive
 * is the first thing those screens ask for; failing to offer the list is not a
 * detail the reader can be left to guess at.
 *
 * `enabled` keeps a route that already has `?drive=` from asking for the list
 * it is not going to show.
 */
export function usePickerDrives(enabled: boolean) {
  const [drives, setDrives] = useState<readonly PickerDrive[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setDrives(await fetchPickerDrives(supabase()));
    } catch {
      setDrives(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { drives, failed, retry: load };
}
