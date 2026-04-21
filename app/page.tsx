"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    const role = user.role;
    if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
    else if (role === "super_admin") router.replace("/admin/dashboard");
    else if (role === "worker") router.replace("/worker/dashboard");
    else router.replace("/dashboard");
  }, [user, loading, router]);

  return <div className="loading-screen"><div className="spinner" /></div>;
}

