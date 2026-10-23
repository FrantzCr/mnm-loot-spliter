import { dismissAllPendingResale } from "@/lib/pending-resale";
import { routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE() {
  try {
    dismissAllPendingResale();
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
