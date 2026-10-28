import { routeError } from "@/lib/http";
import { importSharedPrices, readSharedPricesMeta } from "@/lib/shared-prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ meta: readSharedPricesMeta() });
  } catch (error) {
    return routeError(error);
  }
}

/** Fill missing price_book rows from the shared price book on GitHub — never overwrites local prices. */
export async function POST() {
  try {
    const result = await importSharedPrices();
    return Response.json({ result });
  } catch (error) {
    return routeError(error);
  }
}
