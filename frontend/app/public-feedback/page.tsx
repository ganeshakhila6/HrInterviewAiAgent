"use client";

import dynamic from "next/dynamic";
import React from "react";

// Render the existing client feedback form component. Importing dynamically
// avoids server-side rendering issues since the component is a client component.
const InterviewerFeedbackForm = dynamic(
  () => import("../hr_portal/interviews/Interviewerfeedbackform"),
  { ssr: false }
);

export default function PublicFeedbackPage() {
  return (
    <div>
      <InterviewerFeedbackForm />
    </div>
  );
}
