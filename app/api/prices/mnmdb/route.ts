import { routeError } from "@/lib/http";
import { importMnmdbPrices, readMnmdbImportMeta } from "@/lib/mnmdb-prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ meta: readMnmdbImportMeta() });
  } catch (error) {
    return routeError(error);
  }
}

/** Fill missing price_book rows from mnm-db.com — never overwrites local prices. */
export async function POST() {
  try {
    const result = await importMnmdbPrices();
    return Response.json({ result });
  } catch (error) {
    return routeError(error);
  }
}
