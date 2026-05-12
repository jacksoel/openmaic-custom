"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ThemeToggle } from "@/components/theme-toggle";

interface EnrolledClassroom {
  id: string;
  name: string;
  instructor: string;
  visibility: string;
  createdAt: string;
  isOwner: boolean;
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
              <div className="mb-4 h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              <div className="mt-6 h-4 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string; name: string; role: string } | null>(null);
  const [classrooms, setClassrooms] = useState<EnrolledClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEnrollmentCount, setNewEnrollmentCount] = useState(0);

  useEffect(() => {
    async function loadData() {
      try {
        const { data: sessionData } = await authClient.getSession();
        if (sessionData?.user) {
          const u = sessionData.user as { id: string; email: string; name?: string; role?: string };
          setUser({ id: u.id, email: u.email, name: u.name || u.email, role: u.role || "student" });
        }
        const res = await fetch("/api/user/enrollments");
        if (res.ok) {
          const data = await res.json();
          const fetched = data.classrooms || [];
          setClassrooms(fetched);
          const current = fetched.length;
          const lastSeen = parseInt(localStorage.getItem('lastSeenEnrollmentCount') || '0', 10);
          if (current > lastSeen && lastSeen > 0) setNewEnrollmentCount(current - lastSeen);
          localStorage.setItem('lastSeenEnrollmentCount', String(current));
        } else {
          setError("Failed to load classrooms.");
        }
      } catch {
        setError("Unable to connect. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) return <DashboardSkeleton />;

  const isInstructorOrAdmin = user?.role === "admin" || user?.role === "instructor";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight dark:text-gray-100">
              {user ? `Welcome, ${user.name || user.email}` : "My Classrooms"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {classrooms.length === 0 ? "You have not joined any classrooms yet." : `You are enrolled in ${classrooms.length} classroom${classrooms.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isInstructorOrAdmin && (
              <button onClick={() => router.push("/")} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Create Classroom
              </button>
            )}
            {user?.role === "admin" && (
              <button onClick={() => router.push("/admin")} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Admin</button>
            )}
            <button onClick={() => router.push("/enroll")} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Join a Classroom</button>
            <button onClick={() => router.push("/catalog")} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Browse Classrooms</button>
            <ThemeToggle />
          </div>
        </div>

        {newEnrollmentCount > 0 && (
          <div className="mb-6 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-center justify-between">
            <span>You have been enrolled in {newEnrollmentCount} new classroom{newEnrollmentCount === 1 ? '' : 's'}.</span>
            <button onClick={() => setNewEnrollmentCount(0)} className="ml-4 text-green-500 hover:text-green-700 font-medium">Dismiss</button>
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">{error}</div>
        )}

        {classrooms.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-8 text-center shadow-sm sm:p-12">
            <svg className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">No classrooms yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">Ask your instructor for a classroom code, then join your first OpenMAIC classroom from the enrollment page.</p>
            <button onClick={() => router.push("/enroll")} className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Go to Enrollment</button>
          </div>
        )}

        {classrooms.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classrooms.map((classroom) => (
              <button key={classroom.id} onClick={() => router.push(`/classroom/${classroom.id}`)}
                className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 transition-colors group-hover:text-primary">{classroom.name}</h3>
                  {classroom.isOwner && <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">Owner</span>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{classroom.instructor}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <span>{new Date(classroom.createdAt).toLocaleDateString()}</span>
                  <span className="text-gray-300 dark:text-gray-600">-</span>
                  <span className="capitalize">{classroom.visibility}</span>
                  {user?.role && (<><span className="text-gray-300 dark:text-gray-600">-</span><span className="capitalize">{classroom.isOwner ? "instructor" : user.role}</span></>)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthGuard><DashboardContent /></AuthGuard>;
}
