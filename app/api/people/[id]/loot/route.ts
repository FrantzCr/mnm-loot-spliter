import { ErrorCode } from "@/lib/codes";
import { jsonError } from "@/lib/http";
import { getPersonLoot } from "@/lib/queries";
import { ensureWatcher } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureWatcher();
  const { id } = await context.params;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const loot = getPersonLoot(id, query);
  if (!loot) return jsonError(ErrorCode.personMissing, 404);
  return Response.json(loot);
}
