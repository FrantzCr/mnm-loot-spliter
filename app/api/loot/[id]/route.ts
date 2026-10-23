import { readJson, routeError } from "@/lib/http";
import { removeLootLine, updateLootLine } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson(request);
  try {
    updateLootLine(id, body);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    removeLootLine(id);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
