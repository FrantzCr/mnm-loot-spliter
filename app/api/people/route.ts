import { showEveryone, getDb } from "@/lib/db";
import { listPeople } from "@/lib/queries";
import { ensureWatcher } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureWatcher();
  return Response.json({ people: listPeople(), everyone: showEveryone(getDb()) });
}
