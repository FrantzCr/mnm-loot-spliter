import { settlePartyEveryone } from "@/lib/group";
import { routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json(settlePartyEveryone());
  } catch (error) {
    return routeError(error);
  }
}
