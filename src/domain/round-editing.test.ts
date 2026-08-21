import { describe, expect, it } from "vitest";
import { canManageRounds, describeRoundFreeze, renumberRounds } from "./round-editing";

/**
 * Batch B2 (2026-08-21, answer 2): companies eliminate rounds once a drive
 * starts, so the Central CPC may rename or remove rounds — but a round with
 * any recorded fact is history, and history does not get edited (the 0055
 * freeze principle, extended to a round's name and existence).
 */
describe("describeRoundFreeze", () => {
  it("leaves an untouched round editable", () => {
    expect(
      describeRoundFreeze({ hasParticipants: false, hasAttendance: false, hasResults: false }),
    ).toBeNull();
  });

  it("freezes a round once students are scheduled into it", () => {
    expect(
      describeRoundFreeze({ hasParticipants: true, hasAttendance: false, hasResults: false }),
    ).toMatch(/students are scheduled/i);
  });

  it("freezes a round once attendance is recorded", () => {
    expect(
      describeRoundFreeze({ hasParticipants: true, hasAttendance: true, hasResults: false }),
    ).toMatch(/attendance/i);
  });

  it("freezes a round once results are recorded — the strongest fact wins the wording", () => {
    expect(
      describeRoundFreeze({ hasParticipants: true, hasAttendance: true, hasResults: true }),
    ).toMatch(/results/i);
  });
});

describe("canManageRounds", () => {
  it("is the Central Placement Coordinator's verb alone", () => {
    expect(canManageRounds("central_placement_coordinator")).toBe(true);
  });

  it("refuses every other role", () => {
    for (const role of [
      "admin",
      "student",
      "campus_placement_coordinator",
      "campus_manager",
      "account_executive",
      "delivery_head",
      "key_account_manager",
      "enterprise_relations",
      "er_head",
      "ceo",
    ] as const) {
      expect(canManageRounds(role)).toBe(false);
    }
  });
});

describe("renumberRounds", () => {
  const rounds = [
    { roundId: "r1", sequence: 1, name: "Aptitude" },
    { roundId: "r2", sequence: 2, name: "HR" },
    { roundId: "r3", sequence: 3, name: "Offer release" },
  ];

  it("removes the round and closes the gap — no student can prepare for a hole", () => {
    expect(renumberRounds(rounds, "r2")).toEqual([
      { roundId: "r1", sequence: 1, name: "Aptitude" },
      { roundId: "r3", sequence: 2, name: "Offer release" },
    ]);
  });

  it("removing the last round changes nobody else's number", () => {
    expect(renumberRounds(rounds, "r3")).toEqual([
      { roundId: "r1", sequence: 1, name: "Aptitude" },
      { roundId: "r2", sequence: 2, name: "HR" },
    ]);
  });

  it("removing an unknown round removes nothing", () => {
    expect(renumberRounds(rounds, "r9")).toEqual(rounds);
  });
});
