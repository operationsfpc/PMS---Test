import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useParams } from "react-router";
import { StudentRecordPage } from "./student-record-page";
import { createSupabaseStudentRecordView } from "./student-record-view";

/**
 * `/students/:studentId` — the canonical student record (G7, Q7 answer b).
 * RLS decides who may read the row; a student asking about someone else gets
 * the same "does not exist" as a URL that was never real.
 */
export function StudentRecordRoute() {
  const { studentId } = useParams();
  const [view] = useState(() => createSupabaseStudentRecordView(supabase()));

  if (studentId === undefined) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">No student named in the address.</p>
      </Card>
    );
  }

  return <StudentRecordPage studentId={studentId} view={view} />;
}
