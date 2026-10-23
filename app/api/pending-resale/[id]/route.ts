import { dismissPendingResale } from "@/lib/pending-resale";
import { routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    dismissPendingResale(id);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
