-- =============================================================================
-- SỔ GIAO DỊCH NGÂN HÀNG — chống xử lý trùng webhook
--
-- Bối cảnh: POST /api/payment/webhook trước đây không có xác thực và không có
-- khoá idempotency. Cổng thanh toán (SePay/Casso) retry là chuyện bình thường,
-- nên cùng một giao dịch có thể bị gạch nợ nhiều lần.
--
-- Script này tạo bảng `bank_transactions`, khoá chính là `reference_code` do
-- cổng thanh toán cấp: lần ghi thứ hai bị Postgres từ chối (23505) và route
-- trả về 200 { duplicate: true } mà không cộng tiền lần nữa.
--
-- Chạy 1 lần trong Supabase SQL Editor. Idempotent.
-- =============================================================================

begin;

create table if not exists public.bank_transactions (
    reference_code  varchar(120)   primary key,
    gateway         varchar(60)    not null default 'BANK_GATEWAY',
    transfer_amount numeric(14,2)  not null default 0,
    content         text,
    applied_amount  numeric(14,2)  not null default 0,
    invoice_ids     text,
    student_id      varchar(50),
    result_status   integer        not null default 0,
    result_message  text,
    received_at     timestamptz    not null default now()
);

comment on table public.bank_transactions is
    'Sổ giao dịch biến động số dư nhận từ cổng thanh toán; reference_code là khoá chống replay.';

create index if not exists idx_bank_transactions_received_at
    on public.bank_transactions (received_at desc);

create index if not exists idx_bank_transactions_student
    on public.bank_transactions (student_id)
    where student_id is not null;

-- Backend dùng service_role nên vẫn đọc/ghi bình thường; chặn anon/authenticated.
alter table public.bank_transactions enable row level security;
alter table public.bank_transactions force row level security;
revoke all on public.bank_transactions from anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- Sinh mã ca học không quét toàn bảng
--
-- `POST /api/schedule` trước đây đọc cả bảng schedule_slots (~700 dòng) chỉ để
-- tìm số lớn nhất của `SCHxxxx`. Hàm dưới đây trả về đúng con số đó trong một
-- round trip; `order by id desc` không dùng được vì so sánh chuỗi xếp
-- 'SCH9999' sau 'SCH10000'.
-- =============================================================================

begin;

create or replace function public.max_schedule_slot_number()
returns integer
language sql
stable
as $$
    select coalesce(max(substring(id from 4)::integer), 0)
      from public.schedule_slots
     where id ~ '^SCH[0-9]+$';
$$;

revoke all on function public.max_schedule_slot_number() from anon, authenticated;
grant execute on function public.max_schedule_slot_number() to service_role;

commit;

notify pgrst, 'reload schema';
