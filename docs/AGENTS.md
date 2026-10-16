# AGENTS.md — Nội quy làm việc trong dự án SOP

> Mọi AI agent tham gia dự án này PHẢI đọc và tuân thủ file này trước khi làm bất kỳ việc gì.

## 1. Thứ tự đọc bắt buộc khi bắt đầu phiên mới

1. `AGENTS.md` (file này)
2. `docs/SPEC.md` — đặc tả kỹ thuật, là "luật" của dự án
3. `docs/HANDOFF.md` — thư bàn giao mới nhất: đang làm gì, dở ở đâu
4. `docs/PROGRESS.md` — bảng tiến độ hiện tại
5. `docs/DECISIONS.md` — các quyết định đã chốt, không được tự ý đảo ngược

## 2. Quy tắc giao việc

- Chỉ nhận **một việc tại một thời điểm**. Không tự mở rộng phạm vi việc được giao.
- Việc được giao phải có **tiêu chí nghiệm thu rõ ràng** (tham chiếu mã AC-xxx trong SPEC).
- Nếu yêu cầu mơ hồ hoặc mâu thuẫn với SPEC/DECISIONS → **hỏi lại, không tự đoán**.

## 3. Quy tắc báo cáo tiến độ

- Sau khi xong mỗi việc: cập nhật `docs/PROGRESS.md` (chuyển trạng thái, ghi ngày, ghi cách kiểm chứng).
- Quy ước trạng thái: `pending` (chưa làm) → `in_progress` (đang làm) → `done` (đã code xong)
  → `verified` (đã kiểm chứng chạy được — chỉ dùng khi có bằng chứng: test xanh, ảnh chụp màn hình, link demo).
- **"done" ≠ "verified".** Không bao giờ báo "hoàn thành" khi chưa kiểm chứng được.

## 4. Quy tắc kết thúc phiên (bắt buộc)

Trước khi kết thúc phiên làm việc, phải:
1. Cập nhật `docs/PROGRESS.md` với trạng thái mới nhất.
2. Viết/cập nhật `docs/HANDOFF.md`: đã làm gì, còn dở gì, bước tiếp theo là gì, có gì cần chủ dự án quyết.
3. Lưu bản cũ vào `docs/handoffs/HANDOFF-YYYY-MM-DD.md` nếu có thay đổi quan trọng.

## 5. Quy tắc quyết định

- Mọi quyết định kỹ thuật/kiến trúc mới (đổi stack, đổi schema, đổi luồng) phải ghi vào
  `docs/DECISIONS.md` kèm lý do, và phải được chủ dự án (người, không phải agent) đồng ý nếu
  làm thay đổi SPEC.
- Không tự ý thay đổi nội dung `docs/SPEC.md`. Muốn sửa spec → đề xuất trong HANDOFF.md.

## 6. Quy tắc code

- Tuân thủ kiến trúc và stack trong SPEC.md (mặc định prototype: TypeScript; demo Cloudflare: Workers + D1 + R2).
- Không commit secret, key, mật khẩu vào repo. Dùng biến môi trường.
- Viết test cho logic nghiệp vụ quan trọng. Code phải chạy được trước khi báo done.

## 7. Giao tiếp

- Giao tiếp với chủ dự án bằng **tiếng Việt**, dễ hiểu, không dùng thuật ngữ chuyên môn khi không cần thiết.
- Khi báo cáo: nói **đã làm gì + kiểm chứng bằng gì + còn gì chưa làm**, thay vì chỉ nói "xong rồi".
