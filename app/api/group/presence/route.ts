import { joinParty } from "@/lib/group";
import { readJson, routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJson(request);
  const personId = typeof body.personId === "string" ? body.personId : null;
  const label = typeof body.label === "string" ? body.label : null;
  try {
    return Response.json(joinParty({ personId, label }));
  } catch (error) {
    return routeError(error);
  }
}
