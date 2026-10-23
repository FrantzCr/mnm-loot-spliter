import { ErrorCode } from "@/lib/codes";
import { jsonError, readJson, routeError } from "@/lib/http";
import { getScanSnapshot, scanNow, setWatchPath } from "@/lib/scan";
import { ensureWatcher } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureWatcher();
  return Response.json(getScanSnapshot());
}

export async function PUT(request: Request) {
  ensureWatcher();
  const body = await readJson(request);
  if (typeof body.path !== "string") {
    return jsonError(ErrorCode.watchNeedPath, 400);
  }
  try {
    return Response.json(setWatchPath(body.path));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST() {
  ensureWatcher();
  try {
    return Response.json(scanNow());
  } catch (error) {
    return routeError(error);
  }
}
