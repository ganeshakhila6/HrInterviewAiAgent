"use client";
import type { Candidate } from "@/lib/interviewStore";
import { getRoundSummaryItems } from "@/lib/managerFeedback";
import { X, Star } from "lucide-react";

export default function ManagerSummaryModal({
  candidate,
  onClose,
}: {
  candidate: Candidate;
  onClose: () => void;
}) {
  const items = getRoundSummaryItems(candidate);

  /* Compute avg rating from all rounds that have a numeric rating */
  const ratedItems = items.filter((i) => typeof i.rating === "number" && i.rating > 0);
  const avgRating =
    ratedItems.length > 0
      ? Math.round(
          (ratedItems.reduce((s, i) => s + (i.rating as number), 0) / ratedItems.length) * 10
        ) / 10
      : null;

  /* Best recommendation across rounds (priority order) */
  const recOrder = ["Strong Hire", "Hire", "Hold", "No Hire"];
  const recs = items
    .map((i) => i.recommendation as string | undefined)
    .filter((r): r is string => typeof r === "string" && !!r && !["—", "\u2014", "\u2013"].includes(r));
  const overallRec = recOrder.find((r) => recs.includes(r)) ?? null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(42,26,56,0.35)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "85vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid rgba(221,208,232,0.5)",
          boxShadow: "0 20px 60px rgba(30,27,75,0.15)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            borderBottom: "1px solid rgba(221,208,232,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: candidate.color,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {candidate.initials}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e1b4b" }}>{candidate.name}</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                {candidate.role} · All rounds summary
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "rgba(156,163,175,0.12)",
              borderRadius: 8,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#6b7280",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Overall summary bar — shown only when at least one rated round exists */}
        {(avgRating !== null || overallRec) && (
          <div
            style={{
              display: "flex",
              gap: 16,
              padding: "14px 20px",
              borderBottom: "1px solid rgba(221,208,232,0.2)",
              background: "#f8f7ff",
            }}
          >
            {avgRating !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Avg Rating
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Star size={13} style={{ color: "#B875A0", fill: "#B875A0" }} />
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>{avgRating}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>/5</span>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={11}
                      style={{
                        color: s <= Math.round(avgRating) ? "#B875A0" : "#E0D0E8",
                        fill: s <= Math.round(avgRating) ? "#B875A0" : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {overallRec && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Recommendation
                </span>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    background: "rgba(168,152,216,0.2)",
                    color: "#5A4878",
                    alignSelf: "flex-start",
                  }}
                >
                  {overallRec}
                </span>
              </div>
            )}
            {ratedItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: "auto" }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Rounds Rated
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>
                  {ratedItems.length}/{candidate.rounds.length}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Round-by-round list */}
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {items.length > 0 ? (
            items.map((item) => (
              <div
                key={item.roundNo}
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(221,208,232,0.4)",
                  background: "#f8f7ff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1e1b4b" }}>
                      R{item.roundNo} · {item.type}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.rating != null && item.rating > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#6366F1" }}>
                          ★ {item.rating}/5
                        </span>
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                        background: item.status === "passed" ? "rgba(16,185,129,0.1)" : item.status === "active" ? "rgba(99,102,241,0.1)" : "rgba(156,163,175,0.1)",
                        color: item.status === "passed" ? "#065f46" : item.status === "active" ? "#4f46e5" : "#6b7280",
                      }}>
                        {item.status === "passed" ? "Completed" : item.status === "active" ? "Ongoing" : item.status === "failed" ? "Failed" : "Pending"}
                      </span>
                    </div>
                  </div>
                  {(item.interviewer && item.interviewer !== "TBD") && (
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
                      {item.interviewer}{item.date && item.date !== "TBD" ? ` · ${item.date}` : ""}
                    </div>
                  )}
                  {item.summary ? (
                    <p style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.55 }}>
                      {item.summary}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "#c4bdd0", margin: 0, fontStyle: "italic" }}>
                      {item.status === "passed" ? "Round completed — no written feedback submitted." :
                       item.status === "active" ? "Round in progress — feedback pending." :
                       "Awaiting scheduling."}
                    </p>
                  )}
                  {item.recommendation && !["—", "\u2014", "\u2013"].includes(item.recommendation) && (
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        padding: "3px 10px",
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "rgba(168,152,216,0.15)",
                        color: "#5A4878",
                      }}
                    >
                      {item.recommendation}
                    </span>
                  )}
              </div>
            ))
          ) : (
            <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>
              No rounds found for this candidate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}