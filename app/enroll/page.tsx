"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ThemeToggle } from "@/components/theme-toggle";

interface ClassroomPreview { id: string; name: string; instructor: string; visibility: string; }

function ClassroomLookupSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-4">
      <div className="h-5 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-600" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-600" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-600" />
    </div>
  );
}

function EnrollForm() {
  const router = useRouter();
  const [classroomCode, setClassroomCode] = useState("");
  const [preview, setPreview] = useState<ClassroomPreview | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolledClassId, setEnrolledClassId] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetMessages = () => { setError(null); setToastMessage(null); };

  const handleLookup = async () => {
    resetMessages(); setPreview(null);
    if (!classroomCode.trim()) { setError("Please enter a classroom code."); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/classroom/preview?id=${encodeURIComponent(classroomCode.trim())}`);
      if (!res.ok) { setError(res.status === 404 ? "Classroom not found. Check the code and try again." : "Unable to look up classroom. Please try again."); return; }
      const data = await res.json();
      const classroom = data.preview;
      if (!classroom) { setError("Classroom not found. Check the code and try again."); return; }
      const { data: sessionData } = await authClient.getSession();
      const userId = sessionData?.user?.id;
      if (userId && classroom.enrolledUserIds?.includes(userId)) { setEnrolledClassId(classroom.id); setToastMessage("You are already enrolled in this classroom."); return; }
      if (classroom.visibility === "private") { setError("This classroom is private. Contact your instructor for access."); return; }
      setPreview({ id: classroom.id, name: classroom.stage?.title || classroom.stage?.name || classroom.id, instructor: classroom.ownerName || classroom.ownerId || "Instructor", visibility: classroom.visibility || "enrolled" });
    } catch { setError("Unable to connect. Please check your internet and try again."); }
    finally { setLoading(false); }
  };

  const handleEnroll = async () => {
    if (!preview) return;
    setLoading(true); resetMessages();
    try {
      const res = await fetch("/api/classroom/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classroomId: preview.id }) });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || (res.status === 403 ? "You do not have permission to enroll." : "Enrollment failed. Please try again.")); return; }
      if (data.enrolled === false) { setEnrolledClassId(preview.id); setToastMessage("You are already enrolled in this classroom."); return; }
      setEnrolled(true); setEnrolledClassId(preview.id);
    } catch { setError("Unable to connect. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="mx-auto max-w-4xl mb-4 flex justify-end"><ThemeToggle /></div>
      <div className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight dark:text-gray-100">Join a Classroom</h1>
          <p className="mt-2 text-sm text-muted-foreground">Enter the classroom code provided by your instructor, preview the class, then enroll.</p>
          <div className="mt-6 rounded-lg border border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-800 dark:text-blue-300">Students can join open enrollment classrooms here.</div>
          <button onClick={() => router.push('/dashboard')} className="mt-6 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">← Back to Dashboard</button>
        </section>
        <section className="relative w-full space-y-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm sm:p-8">
          {toastMessage && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{toastMessage}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => router.push(enrolledClassId ? `/classroom/${enrolledClassId}` : "/dashboard")} className="rounded-md bg-amber-100 dark:bg-amber-800 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-200">Open classroom</button>
                  <button onClick={() => { setToastMessage(null); setEnrolledClassId(""); }} className="px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400 leading-none">×</button>
                </div>
              </div>
            </div>
          )}
          {enrolled ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-5 text-center">
                <p className="font-medium text-green-700 dark:text-green-300">✓ Enrolled in {preview?.name || 'classroom'}!</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => router.push(`/classroom/${enrolledClassId}`)}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open Classroom
                </button>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          ) : !preview ? (
            <form onSubmit={e => { e.preventDefault(); handleLookup(); }} className="space-y-5">
              {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400" role="alert">{error}</div>}
              <div className="space-y-2">
                <label htmlFor="classroomCode" className="text-sm font-medium text-gray-700 dark:text-gray-300">Classroom Code</label>
                <input id="classroomCode" type="text" value={classroomCode} onChange={e => { setClassroomCode(e.target.value); resetMessages(); }} required autoComplete="off" disabled={loading} placeholder="e.g. my-classroom-2024"
                  className="block w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50" />
              </div>
              {loading && <ClassroomLookupSkeleton />}
              <button type="submit" disabled={loading || !classroomCode.trim()} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Looking up..." : "Find Classroom"}</button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Classroom preview</p>
                <h2 className="mt-2 text-xl font-semibold dark:text-gray-100">{preview.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Instructor: {preview.instructor}</p>
                <p className="mt-1 text-xs capitalize text-muted-foreground">Visibility: {preview.visibility}</p>
              </div>
              {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={() => { setPreview(null); resetMessages(); }} disabled={loading} className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Back</button>
                <button onClick={handleEnroll} disabled={loading} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">{loading ? "Enrolling..." : "Enroll"}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function EnrollPage() {
  return <AuthGuard><EnrollForm /></AuthGuard>;
}
