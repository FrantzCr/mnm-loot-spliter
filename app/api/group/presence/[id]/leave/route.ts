import { eventTime, leaveParty } from "@/lib/group";
import { readJson, routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    // Optional `at`: in-game leave time from a game-party proposal.
    const body = await readJson(request);
    return Response.json(leaveParty(id, undefined, eventTime(body.at)));
  } catch (error) {
    return routeError(error);
  }
}
