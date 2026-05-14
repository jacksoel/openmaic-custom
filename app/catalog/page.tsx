"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession } from "@/lib/auth-client";

interface CatalogClassroom {
  id: string;
  name: string;
  instructor: string;
  visibility: string;
  enrolledCount: number;
  alreadyEnrolled: boolean;
}

interface PendingClassroom {
  id: string;
  name: string;
  submittedBy: string;
  ownerRole: string;
  enrolledCount: number;
  pendingSince: string;
}

function CatalogContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role || "student";
  const isReviewer = userRole === "admin" || userRole === "instructor";

  const [classrooms, setClassrooms] = useState<CatalogClassroom[]>([]);
  const [pendingClassrooms, setPendingClassrooms] = useState<PendingClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/classroom/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      const data = await res.json();
      setClassrooms(data.classrooms || []);
      setPendingClassrooms(data.pendingClassrooms || []);
      setEnrolledIds(
        new Set<string>(
          (data.classrooms || []).filter((c: CatalogClassroom) => c.alreadyEnrolled).map((c: CatalogClassroom) => c.id)
        )
      );
    } catch {
      setError("Unable to load classroom catalog. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const handleEnroll = async (classroomId: string) => {
    setEnrolling(classroomId);
    try {
      const res = await fetch("/api/classroom/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroomId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Enrollment failed.");
        return;
      }
      setEnrolledIds(prev => new Set([...prev, classroomId]));
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setEnrolling(null);
    }
  };

  const handleReview = async (classroomId: string, decision: "public" | "enrolled") => {
    setReviewing(classroomId);
    try {
      const res = await fetch(`/api/classroom/${classroomId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: decision }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to update visibility.");
        return;
      }
      setPendingClassrooms(prev => prev.filter(c => c.id !== classroomId));
      if (decision === "public") await loadCatalog();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setReviewing(null);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
      <div className="text-sm text-gray-500 dark:text-gray-400">Loading catalog...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight dark:text-gray-100">Browse Classrooms</h1>
            <p className="mt-1 text-sm text-muted-foreground">Discover open classrooms and join ones that interest you.</p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
            >
              ← My Classrooms
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-500">×</button>
          </div>
        )}

        {/* Pending Review Queue — instructor and admin only */}
        {isReviewer && pendingClassrooms.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Pending Review ({pendingClassrooms.length})
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pendingClassrooms.map(classroom => (
                <div
                  key={classroom.id}
                  className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug">{classroom.name}</h3>
                    <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      pending
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">by {classroom.submittedBy}</p>
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    Submitted {new Date(classroom.pendingSince).toLocaleDateString()}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleReview(classroom.id, "public")}
                      disabled={reviewing === classroom.id}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      {reviewing === classroom.id ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReview(classroom.id, "enrolled")}
                      disabled={reviewing === classroom.id}
                      className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => router.push(`/classroom/${classroom.id}`)}
                      className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                      title="Preview"
                    >
                      ↗
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public classrooms */}
        {classrooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-12 text-center">
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">No open classrooms yet</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isReviewer
                ? "Publish a classroom or approve a pending submission to make it discoverable here."
                : "Instructors haven't published any public classrooms yet."}
            </p>
            <button
              onClick={() => router.push("/enroll")}
              className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Enter Classroom Code
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classrooms.map(classroom => {
              const isEnrolled = enrolledIds.has(classroom.id);
              return (
                <div key={classroom.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug">{classroom.name}</h3>
                    <span className="shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                      Public
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{classroom.instructor}</p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{classroom.enrolledCount} enrolled</p>
                  <div className="mt-4">
                    {isEnrolled ? (
                      <div className="flex gap-2">
                        <span className="flex-1 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 py-2 text-center text-xs font-medium text-green-700 dark:text-green-400">
                          ✓ Enrolled
                        </span>
                        <button
                          onClick={() => router.push(`/classroom/${classroom.id}`)}
                          className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          Open
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleEnroll(classroom.id)}
                        disabled={enrolling === classroom.id}
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {enrolling === classroom.id ? "Enrolling..." : "Enroll"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CatalogPage() {
  return <AuthGuard><CatalogContent /></AuthGuard>;
}
