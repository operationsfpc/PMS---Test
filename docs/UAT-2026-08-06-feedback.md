# UAT feedback — "Copy of Testing" (received 2026-08-06)

Source: `~/Downloads/Copy of Testing.pdf`, 14 annotated screenshots.
Extracted verbatim; each item is numbered so commits can cite it.

| # | Page | Area | Request |
|---|---|---|---|
| F1 | 2 | Opt-out / off-campus | Central Placement Coordinator needs a **Decline button with a reason**. The approval or rejection status must go to the student. **No edit button.** Both flows already demand an image (proof of offer / scanned handwritten letter) — keep that. |
| F2 | 2, 5 | Navigation | Opt-out and Off-campus offers are **one bucket in the sidebar**. Split them into **separate heads / different tabs**, for the student and for the Central PC. |
| F3 | 3 | Student | After the self-offer letter is approved the student cannot get back to the submission and its approval status. It must stay visible. |
| F4 | 4 | Dashboard | Registration funnel **overall and campus-wise** — a dropdown defaulting to all campuses. Central PC needs one consolidated dashboard, switching campus to analyse registration and placement per campus. |
| F5 | 4 | Dashboard | The registration funnel keeps only stages **1, 2, 3 and 5**; rename it **Students overview**. Stage 4 ("Applied to a drive") is drive-specific and belongs in a **separate box** filtered by **drive name** and **college name**, showing eligible students (those the drive was opened to), applied, and attendance + clearance in **each round through to the final offer**. |
| F6 | 6 | Admin | No separate Degrees & branches page. **Degree+Branch is one field**, always mapped to a college for a **year of passing**, added/edited under the college. Students pick it from a dropdown on the form. |
| F7 | 7 | AE / PIF | One interview process with multiple designations ⇒ **one PIF**. Multiple interview processes ⇒ **multiple PIFs**. |
| F8 | 7 | Admin | A deactivated role/profile needs an **Activate** button. |
| F9 | 7 | Student | Certificates can be uploaded repeatedly — restrict to a **single upload** per certificate. Delete the previously uploaded test certificates from the database. |
| F10 | 7 | Central PC | A published drive was not reflecting in the student login. (Fixed by migration `0030`; kept here so it is re-verified.) |
| F11 | 7 | AE → Central PC | The AE must supply the **number of rounds**; the publish screen must **fetch it automatically**. |
| F12 | 9 | PIF | Minimum overall CGPA must accept **both a percentage and a GPA**. |
| F13 | 10 | Student | A **"+" button** to add semesters and their marks after registering, because results arrive later. The marks must be verified, and are only visible after **Campus PC approval**. |
| F14 | 11 | Student | **View more** on each drive. A **confirmation warning** before applying ("you are expected to attend all rounds and accept a final offer"). Ask for a **drive-specific resume** at apply time. |
| F15 | 12 | Central PC | The AE's drive module view must also exist for the Central PC, **with shortlisting access**. |
| F16 | 13 | Central PC | After shortlisting, the screen does not change. Fix it. |
| F17 | 14 | Student | The registration form needs a certificate upload: **name of certificate + upload certificate**. |

## Not doable from here

- **F9, second half** — deleting the previously uploaded test certificates is a
  production data operation. Recorded in `docs/PENDING-USER-ACTION.md`.
