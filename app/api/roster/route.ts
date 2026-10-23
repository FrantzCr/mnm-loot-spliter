import { ErrorCode } from "@/lib/codes";
import { getDb, showEveryone } from "@/lib/db";
import { jsonError, readJson, routeError } from "@/lib/http";
import { listPeople } from "@/lib/queries";
import { setShowEveryone } from "@/lib/scan";
import { ensureWatcher } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureWatcher();
  return Response.json({ everyone: showEveryone(getDb()), people: listPeople() });
}

export async function POST(request: Request) {
  ensureWatcher();
  const body = await readJson(request);
  if (typeof body.enabled !== "boolean") return jsonError(ErrorCode.requestFailed, 400);
  try {
    const everyone = setShowEveryone(body.enabled);
    return Response.json({ everyone, people: listPeople() });
  } catch (error) {
    return routeError(error);
  }
}
