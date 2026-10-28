import { ErrorCode } from "@/lib/codes";
import { getDb } from "@/lib/db";
import { readParty, renameParty, resetPot, startParty, type PartyMemberInput } from "@/lib/group";
import { jsonError, readJson, routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const pot = params.get("pot");
    return Response.json(
      readParty(getDb(), id && id.length > 0 ? id : null, pot && /^\d+$/.test(pot) ? Number(pot) : null),
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const members = Array.isArray(body.members) ? body.members.flatMap(memberInput) : [];
    if (members.length === 0) {
      return jsonError(ErrorCode.groupNeedMembers, 400);
    }
    const name = typeof body.name === "string" ? body.name : null;
    return Response.json(startParty(getDb(), members, name));
  } catch (error) {
    return routeError(error);
  }
}

function memberInput(value: unknown): PartyMemberInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [
    {
      personId: typeof record.personId === "string" ? record.personId : null,
      label: typeof record.label === "string" ? record.label : null,
    },
  ];
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    if (typeof body.id !== "string" || body.id.length === 0) return jsonError(ErrorCode.groupMissing, 400);
    return Response.json(renameParty(body.id, body.name));
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE() {
  try {
    return Response.json(resetPot());
  } catch (error) {
    return routeError(error);
  }
}
