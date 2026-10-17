// image.ts — Nén ảnh phía client trước khi tải lên (EVD-008, EVD-009).
// Mặc định: cạnh dài tối đa 1920px, chất lượng 82%, mục tiêu ≤2MB, nguồn ≤15MB.

export interface CompressOptions {
  maxEdge?: number; // cạnh dài tối đa (px)
  quality?: number; // 0..1
  maxBytes?: number; // dung lượng mục tiêu sau nén
  maxSourceBytes?: number; // dung lượng nguồn tối đa
}

const DEFAULTS: Required<CompressOptions> = {
  maxEdge: 1920,
  quality: 0.82,
  maxBytes: 2 * 1024 * 1024,
  maxSourceBytes: 15 * 1024 * 1024,
};

export interface CompressResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  wasCompressed: boolean;
}

/** Nén ảnh bằng canvas. Không phóng lớn ảnh nhỏ. Xoay đúng hướng theo EXIF (cơ bản). */
export async function compressImage(input: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const o = { ...DEFAULTS, ...opts };
  const originalBytes = input.size;
  if (originalBytes > o.maxSourceBytes) {
    throw new Error(`Ảnh nguồn vượt quá ${Math.round(o.maxSourceBytes / 1024 / 1024)}MB.`);
  }

  const bitmap = await createImageBitmap(input).catch(() => null);
  if (!bitmap) throw new Error("Không đọc được ảnh.");

  let { width, height } = bitmap;
  // Không phóng lớn ảnh nhỏ — chỉ thu nhỏ nếu vượt maxEdge.
  const scale = Math.min(1, o.maxEdge / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  // Nếu ảnh đã nhỏ hơn ngưỡng và đúng định dạng JPEG/WebP thì giữ nguyên.
  const alreadySmall = scale === 1 && originalBytes <= o.maxBytes;
  if (alreadySmall && (input.type === "image/jpeg" || input.type === "image/webp")) {
    bitmap.close();
    return { file: input, originalBytes, compressedBytes: originalBytes, width, height, wasCompressed: false };
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) {
    bitmap.close();
    throw new Error("Trình duyệt không hỗ trợ nén ảnh.");
  }
  ctx2d.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Thử các mức chất lượng giảm dần cho tới khi đạt mục tiêu.
  const outType = "image/jpeg";
  let quality = o.quality;
  let blob: Blob | null = null;
  for (let i = 0; i < 4; i++) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, quality));
    if (!blob) break;
    if (blob.size <= o.maxBytes || quality <= 0.5) break;
    quality -= 0.12;
  }
  if (!blob) throw new Error("Nén ảnh thất bại.");

  const name = input.name.replace(/\.[^.]+$/, "") + ".jpg";
  const file = new File([blob], name, { type: outType });
  return {
    file,
    originalBytes,
    compressedBytes: blob.size,
    width: w,
    height: h,
    wasCompressed: true,
  };
}

/** Định dạng dung lượng cho hiển thị. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
