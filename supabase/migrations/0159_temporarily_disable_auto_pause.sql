-- 0159_temporarily_disable_auto_pause.sql
-- Temporarily disable automatic student hold (auto-pause) trigger on drive close.
-- To re-enable, re-create trg_auto_pause_on_drive_close on drives.

drop trigger if exists trg_auto_pause_on_drive_close on drives;
