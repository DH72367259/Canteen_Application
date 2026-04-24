"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RewardsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/pro");
  }, [router]);
  return null;
}
