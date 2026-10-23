import { ErrorCode } from "@/lib/codes";
import { jsonError, readJson, routeError } from "@/lib/http";
import { removePerson, renamePerson } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson(request);
  if (typeof body.name !== "string") return jsonError(ErrorCode.personNeedName, 400);
  try {
    renamePerson(id, body.name);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    removePerson(id);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
