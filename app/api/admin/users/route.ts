import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canViewAllUsers } from "@/lib/roleChecks";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let context;
  try {
    context = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canViewAllUsers(context.role)) {
    return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  }

  const userList = await getAdminAuth().listUsers(100);
  const users = userList.users.map((user) => ({
    uid: user.uid,
    email: user.email,
    disabled: user.disabled,
    providerIds: user.providerData.map((provider) => provider.providerId),
  }));

  return NextResponse.json({ role: context.role, users });
}
