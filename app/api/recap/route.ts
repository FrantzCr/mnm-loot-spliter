import { getDb } from "@/lib/db";
import { readGameParty, recentGamePlayers } from "@/lib/game-party";
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
      playerSuggestions: playerSuggestions(db),
    });
  } catch (error) {
    return routeError(error);
  }
}

/**
 * Autocomplete order: the live in-game party, then players seen in party events this week,
 * then members of past groups. Same shape as recent players; duplicates by name dropped.
 */
function playerSuggestions(db: ReturnType<typeof getDb>) {
  const day = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - 7 * day).toISOString();
  const game = readGameParty(db, new Date(Date.now() - day).toISOString());
  const rows = [
    ...game.members.map((member) => ({ name: member.name, personId: null, lastPlayedAt: member.since, groupStartedAt: member.since })),
    ...recentGamePlayers(db, since).map((player) => ({
      name: player.name,
      personId: null,
      lastPlayedAt: player.lastSeenAt,
      groupStartedAt: player.lastSeenAt,
    })),
    ...listRecentPlayers(db, PLAYER_SUGGESTIONS_LIMIT),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
