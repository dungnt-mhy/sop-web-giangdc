// errors.ts — cấu trúc lỗi JSON thống nhất theo SPEC §12.2.
// Không trả stack trace, SQL hay đường dẫn nội bộ.

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id: string;
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

export function apiError(
  code: keyof typeof STATUS_BY_CODE | string,
  message: string,
  requestId: string,
  details?: unknown
): Response {
  const status = STATUS_BY_CODE[code] ?? 500;
  const body: ApiErrorBody = { error: { code, message, request_id: requestId } };
  if (details !== undefined) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Đọc JSON body an toàn; trả null khi body không phải JSON hợp lệ. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
