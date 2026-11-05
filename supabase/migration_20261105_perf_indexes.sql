-- ============================================================================
-- PERF INDEXES — Phase 1/2 (PERF_OPTIMIZATION_SPEC.md mục 2.6)
-- Ngày: 2026-11-05
-- ----------------------------------------------------------------------------
-- CÁCH CHẠY: Supabase Dashboard -> SQL Editor -> dán toàn bộ file -> RUN.
-- Idempotent: CREATE INDEX IF NOT EXISTS, chạy lại nhiều lần không lỗi.
--
-- Vì sao cần: các endpoint Phase 1 đã đẩy điều kiện xuống SQL, nên giờ chúng
-- lọc theo cặp cột thay vì đọc cả bảng:
--   GET /api/schedule?classId=&date=   -> schedule_slots(class_id, date)
--   GET /api/attendance?date=&classId= -> attendance_records(class_id, date)
--   GET /api/attendance?studentId=     -> attendance_records(student_id, date)
--   GET /api/classes?studentId=        -> class_students(student_id) [đã có index]
--
-- Sau khi chạy, kiểm chứng bằng: EXPLAIN (ANALYZE, BUFFERS) <query>
-- và ANALYZE schedule_slots; ANALYZE attendance_records;
-- ============================================================================

-- Lịch học theo lớp + ngày (màn hình lịch tuần/ngày, đồng bộ ca).
CREATE INDEX IF NOT EXISTS idx_schedule_slots_class_date
  ON public.schedule_slots (class_id, date);

-- Điểm danh theo lớp + ngày (sổ điểm danh ngày, hợp nhất roster).
CREATE INDEX IF NOT EXISTS idx_attendance_class_date
  ON public.attendance_records (class_id, date);

-- Điểm danh theo học viên + ngày (tab điểm danh của học viên).
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
  ON public.attendance_records (student_id, date);
