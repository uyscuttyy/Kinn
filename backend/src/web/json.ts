/** Structured API error with an HTTP status and a stable error code (API.md error model). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Parse a JSON request body into a plain object; rejects with 400 on malformed JSON. */
export async function parseJsonBody(body: string | undefined): Promise<Record<string, unknown>> {
  if (!body || body.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError(400, "INVALID_BODY", "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

/** A stable string field, trimmed, or undefined when absent. */
export function stringField(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "INVALID_INPUT", `${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function requiredString(value: unknown, name: string): string {
  const field = stringField(value, name);
  if (field === undefined) throw new ApiError(400, "INVALID_INPUT", `${name} is required.`);
  return field;
}

export function optionalString(value: unknown, name: string): string | undefined {
  return stringField(value, name);
}

export function optionalBool(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ApiError(400, "INVALID_INPUT", `${name} must be a boolean.`);
  return value;
}
