// Kiểu binding của Worker. Tên binding phải khớp với wrangler.toml.
// Lưu ý: tên binding là định danh JS hợp lệ (không dùng dấu gạch ngang).

export interface Env {
  /** Database D1 của môi trường demo. */
  sop_demo_db: D1Database;
  /** Bucket R2 (riêng tư) chứa ảnh/tệp bằng chứng của môi trường demo. */
  sop_demo_files: R2Bucket;
  /** Tên môi trường: "demo" | "local" (không chứa bí mật). */
  ENV_NAME: string;
}
