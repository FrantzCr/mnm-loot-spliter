import { ErrorCode } from "@/lib/codes";
import { setPartyMode } from "@/lib/group";
import { jsonError, readJson, routeError } from "@/lib/http";
import type { SplitMode } from "@/lib/split";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body.mode !== "items" && body.mode !== "value") {
    return jsonError(ErrorCode.groupBadMode, 400);
  }
  const mode: SplitMode = body.mode;
  try {
    return Response.json(setPartyMode(mode));
  } catch (error) {
    return routeError(error);
  }
}
