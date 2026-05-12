"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthGuard } from "@/components/auth/auth-guard";

interface ClassroomPreview {
  id: string;
  name: string;
  instructor: string;
  visibility: string;
}

function ClassroomLookupSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4" aria-label="Loading classroom preview">
      <div className="h-5 w-2/3 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
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

  useEffect(() => {
    if (!enrolled) return;
    const redirectTimer = window.setTimeout(() => {
      router.push("/dashboard");
    }, 2000);
    return () => window.clearTimeout(redirectTimer);
  }, [enrolled, router]);

  const resetMessages = () => {
    setError(null);
    setToastMessage(null);
  };

  const handleLookup = async () => {
    resetMessages();
    setPreview(null);

    if (!classroomCode.trim()) {
      setError("Please enter a classroom code.");
      return;
    }

    setLoading(true);
    try {
      // Use the preview endpoint: returns name/visibility/instructor without full lesson content,
    // and works for any non-private classroom regardless of enrollment status (fixes B2).
    const res = await fetch(`/api/classroom/preview?id=${encodeURIComponent(classroomCode.trim())}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Classroom not found. Check the code and try again.");
        } else {
          setError("Unable to look up classroom. Please try again.");
        }
        return;
      }

      const data = await res.json();
      // apiSuccess wraps the payload: { success: true, classroom: { ... } }
      const classroom = data.preview;   // preview endpoint wraps under preview key
      if (!classroom) {
        setError("Classroom not found. Check the code and try again.");
        return;
      }
      const { data: sessionData } = await authClient.getSession();
      const userId = sessionData?.user?.id;
      if (userId && classroom.enrolledUserIds?.includes(userId)) {
        setEnrolledClassId(classroom.id);
        setToastMessage("You are already enrolled in this classroom. Open it from your dashboard or jump straight in.");
        return;
      }

      if (classroom.visibility === "private") {
        setError("This classroom is private. Contact your instructor for access.");
        return;
      }

      setPreview({
        id: classroom.id,
        name: classroom.stage?.title || classroom.stage?.name || classroom.id,
        instructor: classroom.ownerName || classroom.ownerId || "Instructor",
        visibility: classroom.visibility || "enrolled",
      });
    } catch {
      setError("Unable to connect. Please check your internet and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (!preview) return;

    setLoading(true);
    resetMessages();
    try {
      const res = await fetch("/api/classroom/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroomId: preview.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setError(data.detail || "You do not have permission to enroll in this classroom.");
        } else {
          setError(data.detail || "Enrollment failed. Please try again.");
        }
        return;
      }

      if (data.enrolled === false) {
        setEnrolledClassId(preview.id);
        setToastMessage("You are already enrolled in this classroom. Open it from your dashboard or jump straight in.");
        return;
      }

      setEnrolled(true);
      setEnrolledClassId(preview.id);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-4 py-8">
      <div className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl border bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Join a Classroom</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the classroom code provided by your instructor, preview the class, then enroll.
          </p>
          <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
            Students can join open enrollment classrooms here. Instructors and admins can still use this page to verify access codes.
          </div>
        </section>

        <section className="relative w-full space-y-6 rounded-xl border bg-white p-6 shadow-sm sm:p-8">
          {toastMessage && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status" aria-live="polite">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{toastMessage}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => router.push(enrolledClassId ? `/classroom/${enrolledClassId}` : "/dashboard")}
                    className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
                  >
                    Open classroom
                  </button>
                  <button
                    type="button"
                    onClick={() => { setToastMessage(null); setEnrolledClassId(""); }}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 leading-none"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}

          {enrolled ? (
            <div className="space-y-4 text-center">
              <div className="rounded-lg border border-green-200 bg-green-50 p-5">
                <p className="font-medium text-green-700">Enrollment confirmed</p>
                <p className="mt-1 text-sm text-green-600">
                  Redirecting you to your dashboard in 2 seconds.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => router.push("/dashboard")}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Go to Dashboard
                </button>
                <button
                  onClick={() => router.push(`/classroom/${enrolledClassId}`)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                >
                  Open Classroom
                </button>
              </div>
            </div>
          ) : !preview ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleLookup(); }}
              className="space-y-5"
            >
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="classroomCode" className="text-sm font-medium text-gray-700">
                  Classroom Code
                </label>
                <input
                  id="classroomCode"
                  type="text"
                  value={classroomCode}
                  onChange={(e) => { setClassroomCode(e.target.value); resetMessages(); }}
                  required
                  autoComplete="off"
                  disabled={loading}
                  placeholder="e.g. my-classroom-2024"
                  className="block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>

              {loading && <ClassroomLookupSkeleton />}

              <button
                type="submit"
                disabled={loading || !classroomCode.trim()}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Looking up..." : "Find Classroom"}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Classroom preview</p>
                <h2 className="mt-2 text-xl font-semibold">{preview.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Instructor: {preview.instructor}</p>
                <p className="mt-1 text-xs capitalize text-muted-foreground">Visibility: {preview.visibility}</p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                  {error}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => { setPreview(null); resetMessages(); }}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                  disabled={loading}
                >
                  Back
                </button>
                <button
                  onClick={handleEnroll}
                  disabled={loading}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? "Enrolling..." : "Enroll"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function EnrollPage() {
  return (
    <AuthGuard>
      <EnrollForm />
    </AuthGuard>
  );
}
