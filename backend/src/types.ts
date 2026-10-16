// Kiểu binding của Worker. Tên binding phải khớp với wrangler.toml.
// Lưu ý: tên binding là định danh JS hợp lệ (không dùng dấu gạch ngang).

export interface Env {
  /** Database D1 của môi trường demo. */
  sop_demo_db: D1Database;
  /** Bucket R2 (riêng tư) chứa ảnh/tệp bằng chứng của môi trường demo. */
  sop_demo_files: R2Bucket;
  /** Tên môi trường: "demo" | "local" (không chứa bí mật). */
  ENV_NAME: string;
  /**
   * Danh sách origin frontend được phép gọi API cross-origin, cách nhau bằng dấu phẩy.
   * Ví dụ local: "http://localhost:8000"; demo: "https://sop-web-giangdc.pages.dev".
   * Dùng cho CORS (Access-Control-Allow-Origin) và kiểm tra CSRF với cookie.
   * Có thể để trống khi frontend và API cùng origin.
   */
  ALLOWED_ORIGINS?: string;
  /** Binding Static Assets: phục vụ file frontend cùng origin với API. */
  ASSETS: Fetcher;
}
