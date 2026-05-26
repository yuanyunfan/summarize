function stringifyErrorPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isUnsupportedResponsesApiError(error: unknown): boolean {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message = error instanceof Error ? error.message : stringifyErrorPart(error);
  const body = stringifyErrorPart(record.responseBody);
  const code = stringifyErrorPart(record.code);
  const errorMessage = stringifyErrorPart(record.errorMessage);
  const details = [message, body, code, errorMessage]
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return (
    /unsupported_api_for_model/i.test(details) ||
    /does not support responses api/i.test(details) ||
    /validating image item:\s*image media type not supported/i.test(details) ||
    /image media type not supported/i.test(details)
  );
}
