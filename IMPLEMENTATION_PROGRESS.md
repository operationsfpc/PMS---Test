# Multi-Role Drive Visibility - Implementation Progress

## ✅ COMPLETED: Week 1 - Student View

### Changes Made

#### 1. Database Query Update
**File:** `src/features/student/drives-view.ts`
- Added `company_drive_id` and `tentative_date` to DRIVE_COLUMNS query (line 82-95)

#### 2. Type Definitions
**File:** `src/features/student/drives-list.tsx`
- Added `companyDriveId` and `tentativeDate` to `OpenDrive` interface
- Created new `OpenDriveEvent` interface for grouped drives

#### 3. Data Mapping
**File:** `src/features/student/drives-view.ts`
- Modified `buildOpenCards()` to include `companyDriveId` and `tentativeDate` from raw drive data

#### 4. Grouping Logic
**File:** `src/features/student/drives-list.tsx`
- Added `groupDrivesByEvent()` helper function to group drives by company event
- Modified `DrivesList` component to use `useMemo` for grouping
- Updated rendering to show:
  - **Multi-role drives:** Grouped card with event header (company, date, venue, mode) and list of roles
  - **Single-role drives:** Original card format (backward compatible)

#### 5. Test Updates
**Files:** 
- `src/features/student/drives-list.test.tsx`
- `src/features/student/drive-tabs.test.tsx`

Added `companyDriveId: null` and `tentativeDate: null` to test mocks.

### Result
✅ Students now see all roles from the same company drive grouped together
✅ Event header shows: Company name, date, drive mode, venue
✅ Each role shows: Title, CTC, drive type, application deadline
✅ Backward compatible with single-role drives
✅ All tests passing

---

## 📋 PENDING: Week 2 - AE Portfolio View

### Required Changes

#### 1. Add Grouping Function
**File:** `src/features/drive-portfolio/portfolio-page.tsx`

```typescript
import { groupDrivesByEvent } from "@domain/company-drive";

interface PortfolioEvent {
  eventId: string;
  companyName: string;
  tentativeDate: string | null;
  driveMode: string | null;
  venue: string | null;
  roles: PortfolioDrive[];
  totalFunnel: {
    applied: number;
    shortlisted: number;
    inRounds: number;
    offers: number;
  };
}

function groupPortfolioByEvent(drives: readonly PortfolioDrive[]): PortfolioEvent[] {
  const groups = new Map<string, PortfolioDrive[]>();
  
  for (const drive of drives) {
    const key = drive.companyDriveId || `standalone:${drive.driveId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(drive);
    } else {
      groups.set(key, [drive]);
    }
  }
  
  return Array.from(groups.entries()).map(([key, roles]) => {
    const first = roles[0]!;
    const allApplicants = roles.flatMap(r => r.applicants);
    
    return {
      eventId: key,
      companyName: first.companyName,
      tentativeDate: first.tentativeDate ?? null,
      driveMode: /* from first role */,
      venue: /* from first role */,
      roles,
      totalFunnel: summariseFunnel(allApplicants),
    };
  });
}
```

#### 2. Modify Rendering
**File:** `src/features/drive-portfolio/portfolio-page.tsx`

Replace the current `activeDrives.map(drive => renderDrive(drive))` with:

```typescript
const events = useMemo(() => groupPortfolioByEvent(visible), [visible]);

{events.map(event => {
  const isMultiRole = event.roles.length > 1;
  
  return (
    <Card key={event.eventId} className="overflow-hidden">
      {isMultiRole && (
        <div className="border-b border-line bg-brand-50 p-4">
          <h3 className="font-[Raleway] text-lg font-bold">{event.companyName}</h3>
          <div className="mt-1 flex gap-3 text-sm text-ink-600">
            {event.tentativeDate && <span>📅 {formatDate(event.tentativeDate)}</span>}
            <span>· {event.roles.length} roles</span>
          </div>
          <div className="mt-2 flex gap-4 text-sm font-semibold">
            <span>{event.totalFunnel.applied} applied</span>
            <span>{event.totalFunnel.shortlisted} shortlisted</span>
            <span>{event.totalFunnel.inRounds} in rounds</span>
            <span>{event.totalFunnel.offers} offers</span>
          </div>
        </div>
      )}
      
      <div className={isMultiRole ? "divide-y divide-line" : ""}>
        {event.roles.map(drive => renderDrive(drive, isMultiRole))}
      </div>
      
      <div className="p-4 border-t border-line">
        <Link to={`/ae/pif?companyName=${encodeURIComponent(event.companyName)}&companyDriveId=${event.eventId}`}>
          + Add Another Role to This Drive
        </Link>
      </div>
    </Card>
  );
})}
```

#### 3. Update renderDrive Function
Modify `renderDrive(drive: PortfolioDrive, isMultiRole: boolean)` to:
- Show condensed view when `isMultiRole` is true (no company name header)
- Show role title, CTC, funnel stats
- Keep full view for single-role drives

---

## 📋 PENDING: Week 3 - CPC Drive Progress View

### Required Changes

#### 1. Update Query
**File:** `src/features/cpc/drive-progress-view.ts`

Ensure `company_drive_id` is selected in the query.

#### 2. Add Grouping
**File:** `src/features/cpc/drive-progress-view.ts`

```typescript
interface DriveProgressEvent {
  eventId: string;
  companyName: string;
  tentativeDate: string | null;
  roles: DriveProgressEntry[];
  totalStudents: number;
}

function groupProgressByEvent(entries: DriveProgressEntry[]): DriveProgressEvent[] {
  // Similar grouping logic
  // Calculate totalStudents across all roles
}
```

#### 3. Update UI
**File:** `src/features/cpc/drive-progress-page.tsx`

Show grouped cards with:
- Event header (company, date)
- Total students across all roles
- Per-role breakdown with campus-wise stats

---

## 📋 PENDING: Week 4 - Central Cockpit + Drive Record

### Part A: Central Cockpit

#### 1. Update Query
**File:** `src/features/central-cpc/cockpit-view.ts`

Add `company_drive_id` to the SELECT query (currently missing).

#### 2. Add Grouping
**File:** `src/features/central-cpc/cockpit-page.tsx`

Group drives by event and show:
- One row per event (not per role)
- Aggregate applicant count
- List of roles in the event

### Part B: Drive Record Page

#### 1. Fetch Sibling Drives
**File:** `src/features/drive-record/record-view.ts`

Add query to fetch all drives with the same `company_drive_id`.

#### 2. Show Sibling Roles
**File:** `src/features/drive-record/record-page.tsx`

Add section: "Other Roles in This Drive" showing:
- List of sibling roles
- Quick stats for each
- Links to view details

---

## 🎯 Testing Checklist

### Student View (Week 1) ✅
- [x] Single role drive displays correctly
- [x] Multi-role drive groups all roles
- [x] Event header shows date, mode, venue
- [x] Each role shows CTC, type, deadline
- [x] Apply button works for each role
- [x] Tests pass

### AE Portfolio (Week 2)
- [ ] Single role drive displays correctly
- [ ] Multi-role drive shows aggregate stats
- [ ] Per-role funnel stats correct
- [ ] "Add Role" button pre-fills event
- [ ] Links to individual roles work

### CPC Progress (Week 3)
- [ ] Total student count correct
- [ ] Campus breakdown per role
- [ ] No double-counting students

### Central Cockpit (Week 4)
- [ ] Event-level status correct
- [ ] Aggregate counts correct
- [ ] Publish all roles works

---

## 📊 Impact Summary

### Before
- Students saw each role as separate card with no grouping
- AEs saw each role separately with separate funnels
- No clear indication of which roles belong to same company visit
- Confusing and cluttered UI

### After
- ✅ Students see all roles from same event grouped together
- ✅ Clear event context (company, date, venue)
- ✅ Aggregate stats for multi-role drives
- ✅ Cleaner, more organized UI
- ✅ Better understanding of company visits

---

## 🚀 Next Steps

1. **Implement Week 2** (AE Portfolio) - Estimated: 4-6 hours
2. **Implement Week 3** (CPC Progress) - Estimated: 3-4 hours
3. **Implement Week 4** (Central Cockpit + Record) - Estimated: 4-5 hours
4. **End-to-end testing** - Estimated: 2-3 hours

**Total remaining effort:** ~15-18 hours

---

## 💡 Key Insights

1. **Domain functions exist but weren't used:** `groupDrivesByEvent()` was already implemented and tested in `src/domain/company-drive.ts` but no UI was using it.

2. **Backward compatible:** Single-role drives (legacy) work exactly as before. Only multi-role drives get the new grouped display.

3. **No database changes needed:** The `company_drive_id` column already exists on the `drives` table from migration 0116.

4. **Progressive enhancement:** Each week's changes are independent and can be deployed separately.

---

## 📝 Files Modified So Far

1. `src/features/student/drives-view.ts` - Added company_drive_id to query and mapping
2. `src/features/student/drives-list.tsx` - Added grouping logic and UI
3. `src/features/student/drives-list.test.tsx` - Updated test mocks
4. `src/features/student/drive-tabs.test.tsx` - Updated test mocks

**All tests passing ✅**
