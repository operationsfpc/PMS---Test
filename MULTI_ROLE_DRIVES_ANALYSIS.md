# Multi-Role Company Drives: Current State & Enhancement Plan

## Executive Summary

The system **already supports** adding multiple roles to a single company drive, but the **UI discovery is poor**. Users must navigate to an existing drive first to add more roles - there's no dedicated "company management" view.

---

## 1. CURRENT ARCHITECTURE (What EXISTS)

### Database Schema (Migration 0116)
```
companies (parent)
    ↓ 1:N
company_drives (recruitment event/visit)
    ↓ 1:N
drives (individual roles within an event)
```

**Key Concept:**
- `company_drives` = One recruitment event (e.g., "Google visits on 2026-10-20")
- `drives` = Individual roles within that event (e.g., "Software Engineer", "Data Analyst")
- Multiple roles share the same `company_drive_id`

### Backend Support ✅

**Repository Method:** `getCompanyEvents(companyName)`
- Location: `src/features/pif/pif-repository.ts:513-607`
- Fetches all existing drive events for a company
- Returns: event ID, date, mode, venue, status, existing roles, contacts

**Atomic Save Function:** `save_company_drive_with_roles()`
- Location: `supabase/migrations/0116_multi_role_company_drives.sql:148-435`
- Creates/updates company, event, and all roles atomically
- Handles upsert logic for adding new roles to existing events

### Frontend Support ✅

**PIF Form - Existing Drive Selector:**
- Location: `src/features/pif/pif-form.tsx:529-645`
- Shows radio buttons for existing drives when company name matches
- Displays: date, status, mode, existing roles, venue
- Allows selecting existing drive OR creating new event

**"Add Role to this Drive" Buttons:**
- Location 1: `src/features/drive-portfolio/portfolio-page.tsx:451-460`
- Location 2: `src/features/drive-record/record-page.tsx:168-176`
- Pre-fills PIF form with company name and drive ID

---

## 2. CURRENT USER FLOW (How it works NOW)

### Scenario: Adding a new role to an existing company drive

**Step 1:** User navigates to Drive Portfolio (`/ae/drive-portfolio` or similar)
**Step 2:** User finds the company's drive in the list
**Step 3:** User clicks "+ Add Role to this Drive (date)" button
**Step 4:** PIF form opens with:
  - Company name pre-filled
  - Company drive ID pre-filled
  - Existing drive selector shows all drives for that company
  - The specific drive is pre-selected
**Step 5:** User fills in new role details
**Step 6:** User submits - new role is linked to existing event

### Alternative Flow (Without navigating to drive first)

**Step 1:** User clicks "Position information form" in sidebar
**Step 2:** User types company name
**Step 3:** If company exists, form shows:
  - "Existing Company" badge
  - All existing drives for that company as radio buttons
**Step 4:** User selects existing drive OR creates new event
**Step 5:** User fills in role details and submits

---

## 3. WHAT'S MISSING (The Problem)

### ❌ No Dedicated Company Management View

**Current Issue:**
- Users can't see "all companies" in one place
- Users can't see "all drives for company X" without navigating to a specific drive first
- The "Add Role" button is buried in drive list/detail pages

**User's Question:**
> "If drive is created with company, if I need to add new role after a period of some days, how can I select already created drive? UI has nothing like I asked right?"

**Answer:** The UI **does** have it, but it's **not discoverable**:
1. User must first find the drive in portfolio/record page
2. Then click the small "+ Add Role" button
3. There's no "Company Management" or "My Companies" section

### ❌ No Proactive "Add Role to Existing Drive" Entry Point

**Missing Navigation Items:**
- No sidebar link: "Manage Companies" or "My Companies"
- No sidebar link: "Add Role to Existing Drive"
- No dedicated page to browse companies and their drives

### ❌ Limited Visibility in PIF Form

**Current Behavior:**
- Existing drive selector only appears AFTER typing company name (min 2 chars)
- User must know the company name to see existing drives
- No way to browse "all companies I've worked with"

---

## 4. ENHANCEMENT PLAN (What Can Be Added)

### Priority 1: Improve Discoverability (Quick Wins)

#### 1.1 Add "My Companies" Section to AE Navigation

**Location:** `src/components/app-shell.tsx` (account_executive nav)

**Add:**
```typescript
{
  heading: "Drive initiation",
  items: [
    { to: "/ae/pif", label: "Position information form" },
    { to: "/ae/companies", label: "My companies" }, // NEW
  ],
}
```

**New Page:** `/ae/companies`
- List all companies the AE has created drives for
- Show: company name, industry, total drives, total roles, latest drive date
- Click company → see all drives for that company
- Click drive → see all roles in that drive
- "Add Role" button on each drive

#### 1.2 Add "Add Role to Existing Drive" Quick Action

**Location:** AE Overview page (`/ae/overview`)

**Add a card/section:**
```
┌─────────────────────────────────────────┐
│ Quick Actions                           │
├─────────────────────────────────────────┤
│ [Create New Drive]  [Add Role to Existing] │
└─────────────────────────────────────────┘
```

**"Add Role to Existing" flow:**
1. Click button → modal/page opens
2. Dropdown: select company (autocomplete)
3. After selecting company → show all existing drives
4. Select drive → open PIF form pre-filled

#### 1.3 Enhance PIF Form Header

**Current:** Just shows "Position Information Form"

**Add:**
```
┌─────────────────────────────────────────────────────────┐
│ Position Information Form                               │
├─────────────────────────────────────────────────────────┤
│ [Create New Drive] | [Add Role to Existing Drive] ← tabs │
└─────────────────────────────────────────────────────────┘
```

**Tab 1:** Create New Drive (current behavior)
**Tab 2:** Add Role to Existing Drive
  - Step 1: Select company (autocomplete with company list)
  - Step 2: Select existing drive (radio buttons with date, roles)
  - Step 3: Fill role details

---

### Priority 2: Company-Centric Views (Medium Effort)

#### 2.1 Company Detail Page

**Route:** `/ae/companies/:companyId`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Google LLC                                              │
│ Industry: Technology | Website: google.com              │
├─────────────────────────────────────────────────────────┤
│ Summary                                                 │
│ - Total Drives: 5                                       │
│ - Total Roles: 12                                       │
│ - First Drive: 2025-08-15                               │
│ - Latest Drive: 2026-10-10                              │
├─────────────────────────────────────────────────────────┤
│ Drive History                              [+ New Drive]│
├─────────────────────────────────────────────────────────┤
│ 📅 2026-10-10 (On-campus)                  [Add Role]  │
│ Roles: Software Engineer, Data Analyst, Product Manager │
│ Status: Live                                            │
│                                                         │
│ 📅 2026-08-20 (Virtual)                    [Add Role]  │
│ Roles: Software Engineer                                │
│ Status: Completed                                       │
│                                                         │
│ 📅 2026-05-15 (On-campus)                  [Add Role]  │
│ Roles: Backend Developer, Frontend Developer            │
│ Status: Completed                                       │
└─────────────────────────────────────────────────────────┘
```

#### 2.2 Drive Detail Page (Enhanced)

**Route:** `/ae/companies/:companyId/drives/:driveId`

**Show:**
- Event details (date, mode, venue, contacts)
- All roles in this drive (cards)
- For each role: title, category, openings, CTC, status, applicant count
- "Add Another Role" button

---

### Priority 3: Advanced Features (Future)

#### 3.1 Drive Template / Clone Feature

**Use Case:** "Google is visiting again next month with similar roles"

**Feature:**
- "Clone this drive" button on existing drive
- Pre-fills PIF form with:
  - Company details
  - Contacts
  - Role details (as template)
  - New date (user changes)

#### 3.2 Recurring Drive Series

**Use Case:** "Google visits every semester"

**Feature:**
- Mark drive as "Recurring"
- System suggests: "Create next drive for Google?"
- Pre-fills everything except date

#### 3.3 Role Library

**Use Case:** "We frequently hire for these 10 roles"

**Feature:**
- Save role templates (title, category, typical CTC, typical eligibility)
- When creating new drive, pick from library
- Customize as needed

#### 3.4 Company Relationship Timeline

**Visual:**
```
2025 ─────── 2026 ─────── 2027
  │            │            │
  ├─ Aug: 2 roles          │
  │            │            │
  ├─ May: 2 roles          │
  │            │            │
  │            ├─ Oct: 3 roles
  │            │            │
  │            ├─ Aug: 1 role
```

---

## 5. IMPLEMENTATION ROADMAP

### Phase 1: Quick Wins (1-2 days)

**Goal:** Make existing functionality discoverable

1. ✅ Add "My Companies" link to AE navigation
2. ✅ Create simple company list page (table view)
3. ✅ Add "Add Role to Existing Drive" button to AE overview
4. ✅ Add tooltip/help text to PIF form explaining the flow

**Deliverables:**
- `/ae/companies` page (basic list)
- Quick action button on overview
- Improved PIF form header with tabs

### Phase 2: Company-Centric Views (3-5 days)

**Goal:** Full company management experience

1. ✅ Company detail page with drive history
2. ✅ Drive detail page with role cards
3. ✅ "Add Role" flow from company page
4. ✅ Breadcrumb navigation: Companies > Google > Oct 2026 Drive

**Deliverables:**
- `/ae/companies/:companyId` page
- `/ae/companies/:companyId/drives/:driveId` page
- Enhanced navigation

### Phase 3: Advanced Features (5-7 days)

**Goal:** Power user features

1. ✅ Drive cloning
2. ✅ Role templates
3. ✅ Recurring drive suggestions
4. ✅ Company timeline visualization

---

## 6. ANSWERS TO YOUR QUESTIONS

### Q1: "This is test site depended on only test env?"

**Answer:** Yes, the test site uses the test environment database. The multi-role company drive architecture (migration 0116) should be applied to both test and production environments.

**Check if migration is applied:**
```sql
SELECT * FROM supabase_migrations.schema_versions 
WHERE version IN ('0116');
```

Or check if tables exist:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('companies', 'company_drives');
```

### Q2: "If drive is created with company, if I need to add new role after a period of some days, how can I select already created drive?"

**Answer:** The functionality EXISTS, but you need to:

**Method 1: From Drive Portfolio**
1. Go to Drive Portfolio (sidebar: Drives > Yet to publish / Live / Completed)
2. Find the company's drive
3. Click "+ Add Role to this Drive (date)" button
4. PIF form opens with drive pre-selected

**Method 2: From PIF Form**
1. Go to Position Information Form (sidebar: Drive initiation > Position information form)
2. Type the company name (min 2 characters)
3. If company exists, you'll see:
   - "Existing Company" badge
   - All existing drives as radio buttons
4. Select the drive you want to add a role to
5. Fill in role details and submit

### Q3: "UI has nothing like I asked right?"

**Answer:** The UI **does** have it, but it's **not obvious**:
- ✅ Backend supports it
- ✅ PIF form has existing drive selector
- ✅ "Add Role" buttons exist on drive pages
- ❌ No dedicated "Company Management" page
- ❌ No sidebar link to "My Companies"
- ❌ No proactive "Add Role to Existing Drive" entry point

**The problem is discoverability, not functionality.**

---

## 7. RECOMMENDED NEXT STEPS

### Immediate (Today)

1. **Test the existing flow:**
   - Create a drive for "Test Company"
   - Go back to drive portfolio
   - Click "+ Add Role to this Drive"
   - Verify new role is added to same event

2. **Check database:**
   - Verify `companies` and `company_drives` tables exist
   - Verify migration 0116 is applied

### Short-term (This Week)

3. **Implement Phase 1 quick wins:**
   - Add "My Companies" to navigation
   - Create basic company list page
   - Add quick action button to overview

### Medium-term (Next Sprint)

4. **Implement Phase 2:**
   - Company detail page
   - Drive detail page
   - Better navigation

---

## 8. TECHNICAL NOTES

### Key Files to Modify

**Navigation:**
- `src/components/app-shell.tsx` (add nav items)

**New Pages:**
- `src/features/companies/companies-page.tsx` (company list)
- `src/features/companies/company-detail-page.tsx` (company detail)
- `src/features/companies/drive-detail-page.tsx` (drive detail)

**Routes:**
- `src/app.tsx` (add routes for new pages)

**Repository:**
- `src/features/pif/pif-repository.ts` (add `getCompaniesForAE()` method)

### Database Queries Needed

**Get all companies for AE:**
```sql
SELECT DISTINCT c.id, c.name, c.industry, c.website,
       COUNT(cd.id) as drive_count,
       MAX(cd.tentative_date) as latest_drive
FROM companies c
JOIN company_drives cd ON cd.company_id = c.id
JOIN drives d ON d.company_drive_id = cd.id
WHERE d.created_by = auth.uid()
GROUP BY c.id, c.name, c.industry, c.website
ORDER BY latest_drive DESC;
```

**Get all drives for company:**
```sql
SELECT cd.id, cd.tentative_date, cd.drive_mode, cd.venue, cd.status,
       ARRAY_AGG(d.role_title) as roles,
       COUNT(d.id) as role_count
FROM company_drives cd
JOIN drives d ON d.company_drive_id = cd.id
WHERE cd.company_id = $1
GROUP BY cd.id, cd.tentative_date, cd.drive_mode, cd.venue, cd.status
ORDER BY cd.tentative_date DESC;
```

---

## 9. CONCLUSION

**Current State:** ✅ Functional but not discoverable
**Problem:** Users can't find the "add role to existing drive" feature
**Solution:** Add company-centric navigation and views

**The system is ready for multi-role company drives - we just need to make it obvious to users.**
