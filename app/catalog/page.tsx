"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { authClient } from "@/lib/auth-client";

interface CatalogClassroom {
  id: string;
  name: string;
  instructor: string;
  visibility: string;
  enrolledCount: number;
  alreadyEnrolled: boolean;
}

function CatalogContent() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<CatalogClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/classroom/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      const data = await res.json();
      setClassrooms(data.classrooms || []);
      // Track already-enrolled set
      const already = new Set<string>(
        (data.classrooms || [])
          .filter((c: CatalogClassroom) => c.alreadyEnrolled)
          .map((c: CatalogClassroom) => c.id)
      );
      setEnrolledIds(already);
    } catch {
      setError("Unable to load classroom catalog. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleEnroll = async (classroomId: string, classroomName: string) => {
    setEnrolling(classroomId);
    try {
      const res = await fetch("/api/classroom/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroomId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Enrollment failed. Please try again.");
        return;
      }
      setEnrolledIds((prev) => new Set([...prev, classroomId]));
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setEnrolling(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading catalog...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Browse Classrooms</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Discover open classrooms and join ones that interest you.
            </p>
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
          >
            ← My Classrooms
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">×</button>
          </div>
        )}

        {classrooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-lg font-medium text-gray-900">No open classrooms yet</p>
            <p className="mt-2 text-sm text-gray-500">
              Instructors haven&apos;t published any public classrooms yet.
              Ask your instructor for a classroom code to join directly.
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
            {classrooms.map((classroom) => {
              const isEnrolled = enrolledIds.has(classroom.id);
              const isEnrolling = enrolling === classroom.id;
              return (
                <div
                  key={classroom.id}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 leading-snug">{classroom.name}</h3>
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 capitalize">
                      {classroom.visibility}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{classroom.instructor}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {classroom.enrolledCount} enrolled
                  </p>
                  <div className="mt-4">
                    {isEnrolled ? (
                      <div className="flex gap-2">
                        <span className="flex-1 rounded-lg border border-green-200 bg-green-50 py-2 text-center text-xs font-medium text-green-700">
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
                        onClick={() => handleEnroll(classroom.id, classroom.name)}
                        disabled={isEnrolling}
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isEnrolling ? "Enrolling..." : "Enroll"}
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
  return (
    <AuthGuard>
      <CatalogContent />
    </AuthGuard>
  );
}
