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
