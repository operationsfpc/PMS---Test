# Multi-Role Drive Visibility: Complete Implementation Plan

## Executive Summary

**Critical Finding:** The domain functions for grouping multi-role drives (`groupDrivesByEvent()`, `countDistinctEvents()`) exist and are tested, but **NO UI view uses them**. Every display surface renders each role as an independent card/row with no visual grouping.

**Problem:** A student seeing "TCS - SDE" and "TCS - QA" as two separate cards has no indication these are part of the same recruitment drive on the same date.

---

## 1. CURRENT STATE (What's Broken)

### 1.1 Student View ❌

**Current:** Each role shown as separate card
```
┌─────────────────────────────────────┐
│ TCS                                 │
│ Software Engineer                   │
│ 6-8 LPA | Placement                 │
│ Apply by: Oct 20                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ TCS                                 │
│ Quality Assurance                   │
│ 5-7 LPA | Placement                 │
│ Apply by: Oct 20                    │
└─────────────────────────────────────┘
```

**Problem:** No indication these are from the same drive/event. Student might think these are unrelated opportunities.

### 1.2 AE Portfolio View ❌

**Current:** Each role shown as separate card with own funnel
```
┌─────────────────────────────────────┐
│ TCS - Software Engineer             │
│ 6-8 LPA | 45 applied | 12 short...  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ TCS - Quality Assurance             │
│ 5-7 LPA | 32 applied | 8 short...   │
└─────────────────────────────────────┘
```

**Problem:** AE can't see the total engagement for the company drive. Has to mentally aggregate.

### 1.3 CPC Drive Progress View ❌

**Current:** Each role shown separately with per-role progress
```
┌─────────────────────────────────────┐
│ TCS - Software Engineer             │
│ Campus A: 20 students               │
│ Campus B: 15 students               │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ TCS - Quality Assurance             │
│ Campus A: 12 students               │
│ Campus B: 10 students               │
└─────────────────────────────────────┘
```

**Problem:** CPC can't see total students participating in the TCS drive event.

### 1.4 Central Cockpit (Yet to Publish / Live) ❌

**Current:** Each role as separate row
```
| Company | Role              | Status   | Applicants |
|---------|-------------------|----------|------------|
| TCS     | Software Engineer | Approved | 45         |
| TCS     | Quality Assurance | Approved | 32         |
```

**Problem:** No visual grouping. Looks like two unrelated drives.

---

## 2. TARGET STATE (What We Need)

### 2.1 Student View ✅

**Grouped by Company Event:**
```
┌─────────────────────────────────────────────────────────┐
│ TCS                                                     │
│ 📅 October 15, 2026 | On-campus                         │
├─────────────────────────────────────────────────────────┤
│ Available Roles (3):                                    │
│                                                         │
│ ① Software Engineer                                     │
│   6-8 LPA | Placement | Full-time                       │
│   Apply by: Oct 10                                      │
│   [Apply Now]                                           │
│                                                         │
│ ② Quality Assurance                                     │
│   5-7 LPA | Placement | Full-time                       │
│   Apply by: Oct 10                                      │
│   [Apply Now]                                           │
│                                                         │
│ ③ Data Analyst                                          │
│   7-9 LPA | Placement | Full-time                       │
│   Apply by: Oct 10                                      │
│   [Apply Now]                                           │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Clear this is ONE company visit on ONE date
- ✅ Student can see all options at once
- ✅ Can apply to multiple roles in same drive
- ✅ Less visual clutter

### 2.2 AE Portfolio View ✅

**Grouped by Event with Aggregate Stats:**
```
┌─────────────────────────────────────────────────────────┐
│ TCS                                                     │
│ 📅 October 15, 2026 | On-campus | Venue: Main Hall      │
├─────────────────────────────────────────────────────────┤
│ TOTAL: 89 applied | 32 shortlisted | 12 in rounds       │
├─────────────────────────────────────────────────────────┤
│ Roles (3):                                              │
│                                                         │
│ ① Software Engineer                                     │
│   6-8 LPA | 45 applied | 15 shortlisted | 6 in rounds  │
│   [View Details] [Shortlist] [Add Role]                 │
│                                                         │
│ ② Quality Assurance                                     │
│   5-7 LPA | 32 applied | 12 shortlisted | 4 in rounds  │
│   [View Details] [Shortlist] [Add Role]                 │
│                                                         │
│ ③ Data Analyst                                          │
│   7-9 LPA | 12 applied | 5 shortlisted | 2 in rounds   │
│   [View Details] [Shortlist] [Add Role]                 │
│                                                         │
│ [+ Add Another Role to This Drive]                      │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ See total engagement for company drive
- ✅ Compare performance across roles
- ✅ One click to add more roles
- ✅ Clear event-level context (date, venue)

### 2.3 CPC Drive Progress View ✅

**Grouped by Event with Campus Breakdown:**
```
┌─────────────────────────────────────────────────────────┐
│ TCS                                                     │
│ 📅 October 15, 2026 | On-campus                         │
├─────────────────────────────────────────────────────────┤
│ TOTAL STUDENTS: 67                                      │
├─────────────────────────────────────────────────────────┤
│ Roles (3):                                              │
│                                                         │
│ ① Software Engineer (32 students)                       │
│   ┌────────────────────────────────────────────┐       │
│   │ Campus A: 20 | Campus B: 12                │       │
│   │ Applied: 32 | Shortlisted: 15 | In Rounds: 6      │
│   └────────────────────────────────────────────┘       │
│   [View Progress]                                       │
│                                                         │
│ ② Quality Assurance (22 students)                       │
│   ┌────────────────────────────────────────────┐       │
│   │ Campus A: 12 | Campus B: 10                │       │
│   │ Applied: 22 | Shortlisted: 12 | In Rounds: 4      │
│   └────────────────────────────────────────────┘       │
│   [View Progress]                                       │
│                                                         │
│ ③ Data Analyst (13 students)                            │
│   ┌────────────────────────────────────────────┐       │
│   │ Campus A: 8 | Campus B: 5                  │       │
│   │ Applied: 13 | Shortlisted: 5 | In Rounds: 2       │
│   └────────────────────────────────────────────┘       │
│   [View Progress]                                       │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ See total students in company drive
- ✅ Campus-wise breakdown per role
- ✅ Track progress across all roles

### 2.4 Central Cockpit (Yet to Publish / Live) ✅

**Grouped by Event:**
```
┌─────────────────────────────────────────────────────────┐
│ TCS | 📅 Oct 15, 2026 | On-campus                      │
├─────────────────────────────────────────────────────────┤
│ 3 roles | 89 total applicants | Status: Live           │
│                                                         │
│ Roles:                                                  │
│ • Software Engineer (45 applicants)                    │
│ • Quality Assurance (32 applicants)                    │
│ • Data Analyst (12 applicants)                         │
│                                                         │
│ [Publish All] [View Details]                           │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ One row per company event, not per role
- ✅ Aggregate stats visible
- ✅ Publish all roles at once

### 2.5 Drive Record/Detail Page ✅

**Show All Sibling Roles:**
```
┌─────────────────────────────────────────────────────────┐
│ TCS - Software Engineer                                │
│ 📅 October 15, 2026 | On-campus | Main Hall            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [Role Details Tab] [Other Roles in This Drive Tab]     │
│                                                         │
│ OTHER ROLES IN THIS DRIVE (2):                         │
│                                                         │
│ ① Quality Assurance                                     │
│   5-7 LPA | 32 applied | 12 shortlisted               │
│   [View Details]                                        │
│                                                         │
│ ② Data Analyst                                          │
│   7-9 LPA | 12 applied | 5 shortlisted                │
│   [View Details]                                        │
│                                                         │
│ [+ Add Another Role]                                    │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ See all roles in same event
- ✅ Quick navigation between roles
- ✅ Clear event context

---

## 3. IMPLEMENTATION PLAN

### Phase 1: Student View (Highest Priority)

**Files to Modify:**
1. `src/features/student/drives-view.ts` - Group drives by `companyDriveId`
2. `src/features/student/drives-list.tsx` - Render grouped cards
3. `src/features/student/drive-tabs.tsx` - Render grouped rows in table view

**Changes:**

#### 3.1 drives-view.ts

```typescript
// Add import
import { groupDrivesByEvent } from "@domain/company-drive";

// Modify buildOpenCards() to group by event
export function buildOpenCards(drives: DriveRow[]): OpenDrive[] {
  const grouped = groupDrivesByEvent(drives);
  
  return grouped.map(event => ({
    eventId: event.eventId,
    companyName: event.companyName,
    tentativeDate: event.tentativeDate,
    driveMode: event.driveMode,
    venue: event.venue,
    roles: event.drives.map(d => ({
      driveId: d.driveId,
      roleTitle: d.roleTitle,
      ctcLabel: d.ctcLabel,
      driveType: d.driveType,
      offerCategory: d.offerCategory,
      applicationCloseDate: d.applicationCloseDate,
      // ... other role-specific fields
    })),
    // ... event-level fields
  }));
}
```

#### 3.2 drives-list.tsx

```typescript
// Replace individual card rendering with grouped rendering
{openDrives.map(drive => (
  <Card key={drive.eventId} className="mb-4">
    <div className="border-b border-line p-4">
      <h3 className="text-lg font-bold">{drive.companyName}</h3>
      <p className="text-sm text-ink-600">
        📅 {drive.tentativeDate} | {drive.driveMode}
        {drive.venue && ` | ${drive.venue}`}
      </p>
    </div>
    
    <div className="p-4">
      <p className="mb-3 text-sm font-semibold text-ink-700">
        Available Roles ({drive.roles.length}):
      </p>
      
      {drive.roles.map((role, idx) => (
        <div key={role.driveId} className="mb-4 last:mb-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold">
                {idx + 1}. {role.roleTitle}
              </p>
              <p className="text-sm text-ink-600">
                {role.ctcLabel} | {role.driveType}
              </p>
            </div>
            <Button>Apply Now</Button>
          </div>
        </div>
      ))}
    </div>
  </Card>
))}
```

### Phase 2: AE Portfolio View

**Files to Modify:**
1. `src/features/drive-portfolio/portfolio-view.ts` - Group by event
2. `src/features/drive-portfolio/portfolio-page.tsx` - Render grouped cards

**Changes:**

#### 3.3 portfolio-view.ts

```typescript
import { groupDrivesByEvent } from "@domain/company-drive";

export function loadPortfolio(userId: string): Promise<PortfolioEvent[]> {
  // ... existing query ...
  
  const grouped = groupDrivesByEvent(drives);
  
  return grouped.map(event => ({
    eventId: event.eventId,
    companyName: event.companyName,
    tentativeDate: event.tentativeDate,
    driveMode: event.driveMode,
    venue: event.venue,
    roles: event.drives.map(d => ({
      driveId: d.driveId,
      roleTitle: d.roleTitle,
      // ... role fields
      applicants: d.applicants,
      funnel: summariseFunnel(d.applicants),
    })),
    totalFunnel: summariseFunnel(event.drives.flatMap(d => d.applicants)),
  }));
}
```

#### 3.4 portfolio-page.tsx

```typescript
{events.map(event => (
  <Card key={event.eventId} className="mb-4">
    <div className="border-b border-line bg-brand-50 p-4">
      <h3 className="text-lg font-bold">{event.companyName}</h3>
      <p className="text-sm text-ink-600">
        📅 {event.tentativeDate} | {event.driveMode}
        {event.venue && ` | ${event.venue}`}
      </p>
      <div className="mt-2 flex gap-4 text-sm">
        <span><strong>{event.totalFunnel.applied}</strong> applied</span>
        <span><strong>{event.totalFunnel.shortlisted}</strong> shortlisted</span>
        <span><strong>{event.totalFunnel.inRounds}</strong> in rounds</span>
      </div>
    </div>
    
    <div className="p-4">
      <p className="mb-3 text-sm font-semibold">
        Roles ({event.roles.length}):
      </p>
      
      {event.roles.map((role, idx) => (
        <div key={role.driveId} className="mb-4 border-l-2 border-brand-200 pl-3">
          <p className="font-semibold">{idx + 1}. {role.roleTitle}</p>
          <p className="text-sm text-ink-600">
            {role.ctcLabel} | {role.funnel.applied} applied | {role.funnel.shortlisted} shortlisted
          </p>
          <div className="mt-2 flex gap-2">
            <Link to={`/drives/${role.driveId}`}>View Details</Link>
            <Link to={`/central/shortlisting?drive=${role.driveId}`}>Shortlist</Link>
          </div>
        </div>
      ))}
      
      <Link
        to={`/ae/pif?companyName=${encodeURIComponent(event.companyName)}&companyDriveId=${event.eventId}`}
        className="mt-3 inline-block text-sm font-semibold text-brand-600"
      >
        + Add Another Role to This Drive
      </Link>
    </div>
  </Card>
))}
```

### Phase 3: CPC Drive Progress View

**Files to Modify:**
1. `src/features/cpc/drive-progress-view.ts` - Group by event
2. `src/features/cpc/drive-progress-page.tsx` - Render grouped cards

**Changes:**

#### 3.5 drive-progress-view.ts

```typescript
import { groupDrivesByEvent } from "@domain/company-drive";

export function loadDriveProgress(campusIds: string[]): Promise<DriveProgressEvent[]> {
  // ... existing query ...
  
  const grouped = groupDrivesByEvent(drives);
  
  return grouped.map(event => ({
    eventId: event.eventId,
    companyName: event.companyName,
    tentativeDate: event.tentativeDate,
    roles: event.drives.map(d => ({
      driveId: d.driveId,
      roleTitle: d.roleTitle,
      byCampus: d.byCampus,
      totalStudents: d.byCampus.reduce((sum, c) => sum + c.count, 0),
    })),
    totalStudents: event.drives.reduce((sum, d) => {
      return sum + d.byCampus.reduce((s, c) => s + c.count, 0);
    }, 0),
  }));
}
```

### Phase 4: Central Cockpit

**Files to Modify:**
1. `src/features/central-cpc/cockpit-view.ts` - Add `company_drive_id` to query, group by event
2. `src/features/central-cpc/cockpit-page.tsx` - Render grouped rows

### Phase 5: Drive Record Page

**Files to Modify:**
1. `src/features/drive-record/record-view.ts` - Fetch sibling drives
2. `src/features/drive-record/record-page.tsx` - Show "Other Roles" section

---

## 4. DATA STRUCTURE CHANGES

### 4.1 New Types

```typescript
// src/domain/company-drive.ts (extend existing)

export interface DriveEvent {
  eventId: string;
  companyName: string;
  tentativeDate: string | null;
  driveMode: string | null;
  venue: string | null;
  status: string;
  drives: Drive[];
}

export interface PortfolioEvent extends DriveEvent {
  totalFunnel: FunnelStats;
}

export interface StudentDriveEvent extends DriveEvent {
  roles: StudentRole[];
}

export interface StudentRole {
  driveId: string;
  roleTitle: string;
  ctcLabel: string;
  driveType: string;
  offerCategory: string | null;
  applicationCloseDate: string | null;
  hasApplied: boolean;
}
```

### 4.2 Database Queries

**No schema changes needed** - `company_drive_id` already exists on `drives` table.

**Query pattern for grouping:**
```sql
SELECT 
  company_drive_id,
  company_name,
  tentative_date,
  drive_mode,
  venue,
  ARRAY_AGG(
    ROW(id, role_title, drive_type, ctc_min_lpa, ctc_max_lpa, ...)
  ) as roles
FROM drives
WHERE status = 'live'
GROUP BY company_drive_id, company_name, tentative_date, drive_mode, venue
ORDER BY tentative_date DESC;
```

---

## 5. PROGRESS TRACKING

### 5.1 Event-Level Progress

```typescript
export function summariseEventProgress(event: DriveEvent): EventProgress {
  const allApplicants = event.drives.flatMap(d => d.applicants);
  
  return {
    totalApplied: allApplicants.length,
    uniqueStudents: new Set(allApplicants.map(a => a.studentId)).size,
    totalShortlisted: allApplicants.filter(a => a.isShortlisted).length,
    totalInRounds: allApplicants.filter(a => a.isInRounds).length,
    totalOffers: allApplicants.filter(a => a.hasOffer).length,
    byRole: event.drives.map(d => ({
      roleTitle: d.roleTitle,
      applied: d.applicants.length,
      shortlisted: d.applicants.filter(a => a.isShortlisted).length,
      inRounds: d.applicants.filter(a => a.isInRounds).length,
      offers: d.applicants.filter(a => a.hasOffer).length,
    })),
  };
}
```

### 5.2 Student Progress Across Roles

```typescript
export function getStudentProgressInEvent(
  event: DriveEvent,
  studentId: string
): StudentEventProgress {
  return {
    eventId: event.eventId,
    companyName: event.companyName,
    appliedRoles: event.drives
      .filter(d => d.applicants.some(a => a.studentId === studentId))
      .map(d => ({
        roleTitle: d.roleTitle,
        progress: applicationProgress(
          d.applicants.find(a => a.studentId === studentId)!
        ),
      })),
  };
}
```

---

## 6. VISUAL DESIGN GUIDELINES

### 6.1 Color Coding

- **Event header:** `bg-brand-50` (light purple) to distinguish from role content
- **Role items:** `border-l-2 border-brand-200` to show they belong to same event
- **Aggregate stats:** `font-bold` to emphasize totals

### 6.2 Information Hierarchy

```
┌─────────────────────────────────────────┐
│ LEVEL 1: COMPANY + EVENT                │ ← Most prominent
│ Company Name                            │
│ Date | Mode | Venue                     │
├─────────────────────────────────────────┤
│ LEVEL 2: AGGREGATE STATS                │ ← Secondary emphasis
│ Total: X applied | Y shortlisted        │
├─────────────────────────────────────────┤
│ LEVEL 3: INDIVIDUAL ROLES               │ ← Details
│ ① Role 1                               │
│ ② Role 2                               │
└─────────────────────────────────────────┘
```

### 6.3 Responsive Design

**Desktop:**
- Event header full width
- Roles in 2-column grid if > 3 roles

**Mobile:**
- Event header stacks vertically
- Roles in single column
- Collapse aggregate stats into expandable section

---

## 7. TESTING CHECKLIST

### 7.1 Student View

- [ ] Single role drive shows correctly (no grouping needed)
- [ ] Multi-role drive groups all roles under one event
- [ ] Student can apply to multiple roles in same event
- [ ] "Applied" badge shows on each applied role
- [ ] Event date/venue visible
- [ ] CTC/drive type visible for each role

### 7.2 AE Portfolio

- [ ] Aggregate funnel stats correct
- [ ] Per-role funnel stats correct
- [ ] "Add Role" button pre-fills correct event
- [ ] Links to individual role details work
- [ ] Shortlisting links work per role

### 7.3 CPC Drive Progress

- [ ] Total student count correct
- [ ] Campus breakdown per role correct
- [ ] Progress tracking per role correct
- [ ] No double-counting students in multiple roles

### 7.4 Central Cockpit

- [ ] Event-level status correct
- [ ] Publish all roles at once works
- [ ] Applicant counts aggregate correctly

---

## 8. MIGRATION PATH

### 8.1 Backward Compatibility

**Existing single-role drives:** Will work as-is. `groupDrivesByEvent()` handles both:
- Drives with `company_drive_id` (new multi-role)
- Drives without `company_drive_id` (legacy single-role)

**No data migration needed** - all existing drives remain valid.

### 8.2 Feature Flags (Optional)

If concerned about rollout:
```typescript
const enableGroupedDrives = featureFlag('grouped-drive-display');

if (enableGroupedDrives) {
  return <GroupedDriveList drives={drives} />;
} else {
  return <LegacyDriveList drives={drives} />;
}
```

---

## 9. IMPLEMENTATION PRIORITY

### Week 1: Student View (Critical)
- [ ] Modify `drives-view.ts` to group by event
- [ ] Update `drives-list.tsx` to render grouped cards
- [ ] Update `drive-tabs.tsx` for table view
- [ ] Test with 2-3 role drive

### Week 2: AE Portfolio (High)
- [ ] Modify `portfolio-view.ts` to group by event
- [ ] Update `portfolio-page.tsx` to render grouped cards
- [ ] Add aggregate funnel stats
- [ ] Test progress tracking

### Week 3: CPC Views (Medium)
- [ ] Modify `drive-progress-view.ts`
- [ ] Update `drive-progress-page.tsx`
- [ ] Test campus breakdown

### Week 4: Central Cockpit + Polish (Medium)
- [ ] Modify `cockpit-view.ts`
- [ ] Update `cockpit-page.tsx`
- [ ] Add drive record page sibling roles
- [ ] Full end-to-end testing

---

## 10. SUCCESS METRICS

### 10.1 Student Experience

- **Metric:** % of students applying to multiple roles in same event
- **Target:** 30% increase in multi-role applications
- **Why:** Better visibility should encourage applying to multiple roles

### 10.2 AE Efficiency

- **Metric:** Time to add new role to existing drive
- **Target:** 50% reduction (from 2 min to 1 min)
- **Why:** Clearer UI should make it faster

### 10.3 CPC Clarity

- **Metric:** Support tickets asking "how many students in X drive?"
- **Target:** 70% reduction
- **Why:** Aggregate stats should answer this directly

---

## 11. CONCLUSION

**Current State:** Multi-role drives exist in database but UI treats every role as independent.

**Solution:** Use existing `groupDrivesByEvent()` function across all views to group roles by event.

**Impact:**
- ✅ Students see all roles from same company visit together
- ✅ AEs see aggregate stats for company drive
- ✅ CPCs see total student engagement
- ✅ Everyone sees clear event context (date, venue, company)

**Effort:** 4 weeks for full rollout across all views.

**Risk:** Low - domain functions already tested, no schema changes needed.

**Next Step:** Start with student view (Week 1) as it's highest impact.
