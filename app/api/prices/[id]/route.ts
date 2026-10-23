import { readJson, routeError } from "@/lib/http";
import { deletePrice, updatePrice } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson(request);
  try {
    updatePrice(id, body.itemName, body.unitCopper);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    deletePrice(id);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
