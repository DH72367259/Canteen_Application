"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    if (!loading && user) {
      // Redirect to correct dashboard based on role
      if (user.role === "super_admin") router.replace("/admin/dashboard");
      else if (user.role === "canteen_admin" || user.role === "vendor") router.replace("/vendor/dashboard");
      else if (user.role === "worker") router.replace("/worker/dashboard");
      else router.replace("/dashboard");
    }
  }, [user, loading, router]);

  return <div className="page-loading"><div className="spinner" /></div>;
}
