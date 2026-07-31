/**
 * Fixtures for the UI mocks. Replaced by MSW handlers, then by Supabase.
 * Deliberately shaped like the domain types so the swap is mechanical.
 */

export interface MockStudent {
  readonly id: string;
  readonly name: string;
  readonly rollNumber: string;
  readonly degree: string;
  readonly branch: string;
  readonly cgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly submittedAt: string;
}

export const PENDING_SRFS: readonly MockStudent[] = [
  {
    id: "s1",
    name: "Priya Ramesh",
    rollNumber: "21CSE1042",
    degree: "B.E",
    branch: "CSE",
    cgpa: 8.24,
    currentArrears: 0,
    historyOfArrears: 0,
    submittedAt: "2 hours ago",
  },
  {
    id: "s2",
    name: "Arjun Menon",
    rollNumber: "21CSE1088",
    degree: "B.E",
    branch: "CSE",
    cgpa: 7.1,
    currentArrears: 1,
    historyOfArrears: 3,
    submittedAt: "5 hours ago",
  },
  {
    id: "s3",
    name: "Fathima Noor",
    rollNumber: "21IT2011",
    degree: "B.E",
    branch: "IT",
    cgpa: 9.02,
    currentArrears: 0,
    historyOfArrears: 1,
    submittedAt: "Yesterday",
  },
];

export interface MockPif {
  readonly id: string;
  readonly company: string;
  readonly role: string;
  readonly roleCategory: string;
  readonly ctcMin: number;
  readonly ctcMax: number | null;
  readonly openings: number;
  readonly raisedBy: string;
  readonly campuses: number;
  readonly onHold: boolean;
}

export const PENDING_PIFS: readonly MockPif[] = [
  {
    id: "p1",
    company: "Zoho Corporation",
    role: "Member Technical Staff",
    roleCategory: "Software / Technical",
    ctcMin: 6.5,
    ctcMax: 9,
    openings: 40,
    raisedBy: "R. Karthik (AE)",
    campuses: 4,
    onHold: false,
  },
  {
    id: "p2",
    company: "Freshworks",
    role: "Associate Product Support",
    roleCategory: "Technical Support / IT Operations",
    ctcMin: 4.5,
    ctcMax: null,
    openings: 25,
    raisedBy: "S. Divya (AE)",
    campuses: 2,
    onHold: true,
  },
  {
    id: "p3",
    company: "Goldman Sachs",
    role: "Analyst — Engineering",
    roleCategory: "Software / Technical",
    ctcMin: 18,
    ctcMax: 22,
    openings: 6,
    raisedBy: "R. Karthik (AE)",
    campuses: 1,
    onHold: false,
  },
];

export interface MockApplicant {
  readonly id: string;
  readonly name: string;
  readonly rollNumber: string;
  readonly cgpa: number;
  readonly aptitude: number;
  readonly coding: number;
  readonly communication: number;
  readonly score: number;
  readonly rationale: string;
}

export const APPLICANTS: readonly MockApplicant[] = [
  {
    id: "a1",
    name: "Fathima Noor",
    rollNumber: "21IT2011",
    cgpa: 9.02,
    aptitude: 88,
    coding: 92,
    communication: 79,
    score: 91,
    rationale: "Top coding score; 3 relevant projects; no standing arrears.",
  },
  {
    id: "a2",
    name: "Priya Ramesh",
    rollNumber: "21CSE1042",
    cgpa: 8.24,
    aptitude: 81,
    coding: 84,
    communication: 88,
    score: 84,
    rationale: "Strong communication; React and SQL match mandatory skills.",
  },
  {
    id: "a3",
    name: "Vikram Iyer",
    rollNumber: "21CSE1170",
    cgpa: 7.8,
    aptitude: 76,
    coding: 71,
    communication: 74,
    score: 72,
    rationale: "Meets cutoff; coding score below cohort median for this role.",
  },
  {
    id: "a4",
    name: "Arjun Menon",
    rollNumber: "21CSE1088",
    cgpa: 7.1,
    aptitude: 62,
    coding: 58,
    communication: 70,
    score: 61,
    rationale: "1 standing arrear; below median on aptitude and coding.",
  },
];

export interface MockAttendee {
  readonly id: string;
  readonly name: string;
  readonly rollNumber: string;
  readonly priorAbsences: number;
}

export const ROUND_ATTENDEES: readonly MockAttendee[] = [
  { id: "a1", name: "Fathima Noor", rollNumber: "21IT2011", priorAbsences: 0 },
  { id: "a2", name: "Priya Ramesh", rollNumber: "21CSE1042", priorAbsences: 1 },
  { id: "a3", name: "Vikram Iyer", rollNumber: "21CSE1170", priorAbsences: 2 },
  { id: "a4", name: "Arjun Menon", rollNumber: "21CSE1088", priorAbsences: 0 },
];

// ---------------------------------------------------------------------------
// A realistic cohort, used to compute LIVE audience counts in the DAF builder
// by running the actual domain rules rather than faking a number.
// ---------------------------------------------------------------------------

import type { Offer } from "@domain/offers";
import type { AcademicProfile, ParticipationStatus, SrfStatus } from "@domain/types";

export interface CohortStudent {
  readonly id: string;
  readonly name: string;
  readonly rollNumber: string;
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly academics: AcademicProfile;
  readonly offers: readonly Offer[];
}

const declaredAt = new Date("2026-06-12T00:00:00Z");

const placement = (id: string, category: Offer["offerCategory"], ctcLpa: number): Offer => ({
  id,
  driveId: `d-${id}`,
  driveType: "placement",
  offerCategory: category,
  ctcLpa,
  declaredAt,
  source: "on_campus",
});

const internship = (id: string): Offer => ({
  id,
  driveId: `d-${id}`,
  driveType: "internship",
  offerCategory: null,
  ctcLpa: 0,
  declaredAt,
  source: "on_campus",
});

const base = {
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  tenthPercentage: 88,
  twelfthPercentage: 85,
  currentArrears: 0,
  historyOfArrears: 0,
  city: "Chennai",
  campus: "Alliance University",
} satisfies Omit<AcademicProfile, "overallCgpa">;

const mk = (
  id: string,
  name: string,
  rollNumber: string,
  academics: Partial<AcademicProfile> & Pick<AcademicProfile, "overallCgpa">,
  extra: Partial<Pick<CohortStudent, "srfStatus" | "participationStatus" | "offers">> = {},
): CohortStudent => ({
  id,
  name,
  rollNumber,
  srfStatus: "srf_approved",
  participationStatus: "active",
  offers: [],
  academics: { ...base, ...academics },
  ...extra,
});

export const COHORT: readonly CohortStudent[] = [
  mk("c1", "Fathima Noor", "21IT2011", { overallCgpa: 9.02, branch: "IT" }),
  mk(
    "c2",
    "Priya Ramesh",
    "21CSE1042",
    { overallCgpa: 8.24 },
    {
      offers: [placement("o1", "dream", 7.5)],
    },
  ),
  mk("c3", "Vikram Iyer", "21CSE1170", { overallCgpa: 7.8 }),
  mk("c4", "Arjun Menon", "21CSE1088", {
    overallCgpa: 7.1,
    currentArrears: 1,
    historyOfArrears: 3,
  }),
  mk(
    "c5",
    "Neha Gupta",
    "21CSE1201",
    { overallCgpa: 9.4 },
    {
      offers: [placement("o2", "super_dream", 24)],
    },
  ),
  mk("c6", "Rahul Nair", "21ECE3007", { overallCgpa: 8.0, branch: "ECE" }),
  mk("c7", "Sneha Rao", "22MCA0044", {
    overallCgpa: 8.6,
    degree: "MCA",
    branch: "Not applicable",
    campus: "VIT Bangalore",
    city: "Bengaluru",
  }),
  mk("c8", "Imran Sheikh", "21CSE1310", { overallCgpa: 6.2, historyOfArrears: 2 }),
  mk(
    "c9",
    "Divya Suresh",
    "21IT2099",
    { overallCgpa: 8.9, branch: "IT" },
    {
      offers: [internship("o3")],
    },
  ),
  mk(
    "c10",
    "Karan Bhatia",
    "21CSE1455",
    { overallCgpa: 7.4 },
    {
      participationStatus: "opted_out",
    },
  ),
  mk(
    "c11",
    "Meera Pillai",
    "21CSE1502",
    { overallCgpa: 8.1 },
    {
      participationStatus: "disbarred",
    },
  ),
  mk(
    "c12",
    "Aditya Rane",
    "21CSE1560",
    { overallCgpa: 8.7 },
    {
      srfStatus: "srf_submitted",
    },
  ),
];

export interface MockDrive {
  readonly id: string;
  readonly company: string;
  readonly role: string;
  readonly status: string;
  readonly tone: "neutral" | "brand" | "success" | "warning" | "danger";
  readonly detail: string;
  readonly action: string;
  readonly onHold?: boolean;
}

export const COCKPIT_DRIVES: readonly MockDrive[] = [
  {
    id: "d1",
    company: "Goldman Sachs",
    role: "Analyst — Engineering",
    status: "Approved — needs completion",
    tone: "warning",
    detail: "3 mandatory fields missing · Super Dream · ₹18–22 LPA",
    action: "Complete and publish",
  },
  {
    id: "d2",
    company: "Freshworks",
    role: "Associate Product Support",
    status: "On hold",
    tone: "neutral",
    detail: "Held by Delivery Head · awaiting SPOC confirmation",
    action: "Review",
    onHold: true,
  },
  {
    id: "d3",
    company: "Zoho Corporation",
    role: "Member Technical Staff",
    status: "In rounds",
    tone: "brand",
    detail: "Round 3 of 4 · 41 in process · 2 absences flagged",
    action: "Manage rounds",
  },
  {
    id: "d4",
    company: "Sprinklr",
    role: "Product Engineer",
    status: "Applications closed",
    tone: "warning",
    detail: "88 applicants · shortlisting not started",
    action: "Start shortlisting",
  },
  {
    id: "d5",
    company: "Accenture",
    role: "Associate Software Engineer",
    status: "Completed",
    tone: "success",
    detail: "34 selected · offer letters uploaded",
    action: "View report",
  },
];
