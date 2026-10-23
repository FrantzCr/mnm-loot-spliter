import { settlePartyPresence } from "@/lib/group";
import { routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    return Response.json(settlePartyPresence(id));
  } catch (error) {
    return routeError(error);
  }
}
