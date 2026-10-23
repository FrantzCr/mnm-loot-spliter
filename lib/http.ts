import { ErrorCode, statusForCode } from "@/lib/codes";

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : ErrorCode.requestFailed;
  return jsonError(message, statusForCode(message));
}
