import { getDb } from "@/lib/db";
import { routeError } from "@/lib/http";
import { listPendingResale, listRecentPlayers, PLAYER_SUGGESTIONS_LIMIT } from "@/lib/pending-resale";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();
    return Response.json({
      pendingResale: listPendingResale(db),
      recentPlayers: listRecentPlayers(db),
      playerSuggestions: listRecentPlayers(db, PLAYER_SUGGESTIONS_LIMIT),
    });
  } catch (error) {
    return routeError(error);
  }
}
