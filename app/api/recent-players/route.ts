import { dismissRecentPlayer } from "@/lib/pending-resale";
import { readJson, routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    dismissRecentPlayer(body.name, body.personId ?? null);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
