import { randomUUID } from "crypto";

const requestIdPattern = /^[A-Za-z0-9._-]{1,100}$/;

type RequestErrorRecord = {
  service: string;
  requestId: string;
  elapsedMs: number;
  error: "operation_failed";
};

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
}

export function safeRequestError(service: string, requestId: string, elapsedMs: number): RequestErrorRecord {
  return { service, requestId, elapsedMs: Math.max(0, Math.round(elapsedMs)), error: "operation_failed" };
}

export function logSafeRequestError(service: string, requestId: string, startedAt: number, error: unknown): void {
  void error;
  console.error(safeRequestError(service, requestId, Date.now() - startedAt));
}
