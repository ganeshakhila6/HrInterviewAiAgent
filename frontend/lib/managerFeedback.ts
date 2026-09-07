import type { Candidate } from "./interviewStore";

export function hasAllRoundsCompleted(candidate: Candidate): boolean {
  return (
    candidate.rounds.length >= 4 &&
    candidate.rounds.every((r) => r.status === "passed")
  );
}

export function getRoundStatusLabel(candidate: Candidate, roundNo: number): string {
  const round = candidate.rounds.find((r) => r.roundNo === roundNo);
  if (!round) return "—";
  if (round.status === "passed") return "Completed";
  if (round.status === "failed") return "Failed";
  if (round.status === "active") return "In Progress";
  if (round.status === "on-hold") return "On Hold";
  return "Pending";
}

export function isRoundCompleted(candidate: Candidate, roundNo: number): boolean {
  return candidate.rounds.find((r) => r.roundNo === roundNo)?.status === "passed";
}

export function getRoundSummaryItems(candidate: Candidate) {
  return candidate.rounds
    .slice()
    .sort((a, b) => a.roundNo - b.roundNo)
    .map((r) => ({
      roundNo:        r.roundNo,
      type:           r.type,
      date:           r.date,
      interviewer:    r.interviewer,
      status:         r.status,
      summary:        r.feedback?.summary ?? "",
      recommendation: r.feedback?.recommendation,
      rating:         r.feedback?.rating,
    }));
}

export function buildCombinedSummary(candidate: Candidate): string {
  const parts = candidate.rounds
    .filter((r) => r.feedback?.summary)
    .sort((a, b) => a.roundNo - b.roundNo)
    .map((r) => `R${r.roundNo} (${r.type}): ${r.feedback!.summary}`);

  if (parts.length > 0) return parts.join(" · ");
  return `${candidate.name} has completed all interview rounds. Review consolidated feedback before approval.`;
}

export function getCandidatesAwaitingApproval(candidates: Candidate[]): Candidate[] {
  return candidates.filter(hasAllRoundsCompleted);
}

import type { CSSProperties } from "react";

export const completedPill: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 700,
  background: "rgba(16,185,129,0.1)",
  color: "#065f46",
};

export const pendingPill: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 700,
  background: "rgba(156,163,175,0.15)",
  color: "#6b7280",
};
