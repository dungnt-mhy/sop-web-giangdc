import type { Env } from "./types";

// Task 01: Worker tối thiểu — chỉ phục vụ kiểm tra sức khoẻ.
// Các endpoint nghiệp vụ (xác thực, quy trình, lượt thực hiện...) thuộc các task sau.

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        {
          status: "ok",
          service: "sop-api",
          env: env.ENV_NAME ?? "unknown",
          time: new Date().toISOString(),
          bindings: {
            d1: Boolean(env.sop_demo_db),
            r2: Boolean(env.sop_demo_files),
          },
        },
        200
      );
    }

    return json({ status: "error", message: "Not found" }, 404);
  },
};
