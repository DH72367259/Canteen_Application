import { NextResponse } from "next/server";
import { menuItems } from "@/lib/menu";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ menu: menuItems });
}
