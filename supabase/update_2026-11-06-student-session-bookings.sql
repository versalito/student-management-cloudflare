-- ============================================================================
-- Update 2026-11-06: Hoc sinh dang ky tung buoi le (khong theo ca dai han)
-- Dan cho SQL Editor (Supabase). An toan chay lai nhieu lan.
--
-- Mot ban ghi = mot hoc sinh dat mot buoi cu the cua mot lop dang mo.
-- Khong co suc chua lop: booking chi bi chan boi slot da qua / da huy /
-- lop da ket thuc / trung gio voi buoi khac cua chinh hoc sinh do.
-- ============================================================================

begin;

CREATE TABLE IF NOT EXISTS public.student_session_bookings (
    id         varchar(50) PRIMARY KEY,
    student_id varchar(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    slot_id    varchar(50) NOT NULL REFERENCES public.schedule_slots(id) ON DELETE CASCADE,
    status     varchar(20) NOT NULL DEFAULT 'Đã đăng ký',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT student_session_bookings_status_check
        CHECK (status IN ('Đã đăng ký', 'Đã hủy', 'Đã học')),
    CONSTRAINT student_session_bookings_unique UNIQUE (student_id, slot_id)
);

-- RLS: backend dung service_role. Bat RLS khong policy = anon key khong doc duoc.
ALTER TABLE public.student_session_bookings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_student_session_bookings_student
    ON public.student_session_bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_student_session_bookings_slot
    ON public.student_session_bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_student_session_bookings_status
    ON public.student_session_bookings(status);

commit;

-- Lam PostgREST doc lai schema ngay
notify pgrst, 'reload schema';
