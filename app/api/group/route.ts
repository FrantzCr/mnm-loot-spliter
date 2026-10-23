import { ErrorCode } from "@/lib/codes";
import { getDb } from "@/lib/db";
import { readParty, resetParty, startParty, type PartyMemberInput } from "@/lib/group";
import { jsonError, readJson, routeError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(readParty());
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
    return Response.json(startParty(getDb(), members));
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

export async function DELETE() {
  try {
    return Response.json(resetParty());
  } catch (error) {
    return routeError(error);
  }
}
