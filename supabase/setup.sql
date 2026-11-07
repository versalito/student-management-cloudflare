-- ============================================================================
-- STUDENT MANAGEMENT — SETUP SUPABASE
-- ----------------------------------------------------------------------------
-- File này tạo toàn bộ schema mà ứng dụng cần, kèm dữ liệu danh mục nền.
-- Chạy được nhiều lần trên cùng một database: database trống thì tạo mới,
-- database đang chạy thì chỉ bổ sung phần còn thiếu, không xoá dữ liệu.
--
-- Cách dùng: Supabase Dashboard -> SQL Editor -> dán toàn bộ file -> Run.
--
-- Sau khi chạy xong, cấu hình cho Worker:
--   SUPABASE_URL                = https://<project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY   = <service role key>
--   DATA_SOURCE                 = supabase
--
-- Bảo mật: mọi bảng đều bật RLS và KHÔNG có policy nào. Backend gọi bằng
-- service_role nên bỏ qua RLS; anon key (lộ ra ngoài) không đọc/ghi được gì.
-- ============================================================================

begin;

create extension if not exists "uuid-ossp";
create extension if not exists "citext";

-- ============================================================================
-- 1. BẢNG
-- ============================================================================

-- Người dùng đăng nhập (admin, giáo viên, học sinh)
create table if not exists public.users (
    id            varchar(50)  primary key,
    username      citext       not null,
    password_hash varchar(255) not null,
    role          varchar(20)  not null,
    name          varchar(255) not null,
    avatar        text,
    is_active     boolean      not null default true,
    created_at    timestamptz  not null default now(),
    updated_at    timestamptz  not null default now(),
    constraint users_role_check check (role in ('ADMIN', 'TEACHER', 'STUDENT'))
);

-- Giáo viên (hồ sơ mở rộng của users)
create table if not exists public.teachers (
    id          varchar(50)  primary key references public.users(id) on delete cascade,
    name        varchar(255) not null,
    phone       varchar(50)  not null,
    specialty   varchar(255) not null,
    hourly_rate numeric(12,2) not null default 0,
    status      varchar(50)  not null default 'Đang dạy',
    bio         text,
    created_at  timestamptz  not null default now(),
    updated_at  timestamptz  not null default now(),
    constraint teachers_status_check check (status in ('Đang dạy', 'Nghỉ phép'))
);

-- Học sinh (hồ sơ mở rộng của users)
create table if not exists public.students (
    id                       varchar(50)  primary key references public.users(id) on delete cascade,
    name                     varchar(255) not null,
    phone                    varchar(50)  not null,
    date_of_birth            date,
    gender                   varchar(10)  not null default 'Nam',
    address                  text,
    status                   varchar(50)  not null default 'Đang học',
    avatar_url               text,
    parent_phone             varchar(50),
    assignment_url           text,
    home_town                varchar(255),
    grade_level              varchar(50),
    target_university        varchar(100),
    custom_university        varchar(255),
    exam_block               varchar(20),
    study_goal               varchar(255),
    facebook_url             text,
    other_notes              text,
    registered_date          date,
    total_sessions_in_month  integer default 12,
    attended_sessions_in_month integer default 0,
    absent_sessions_in_month integer default 0,
    remaining_sessions       integer default 12,
    created_at               timestamptz  not null default now(),
    updated_at               timestamptz  not null default now(),
    constraint students_gender_check check (gender in ('Nam', 'Nữ')),
    constraint students_status_check check (status in ('Đang học', 'Tạm dừng', 'Đã nghỉ học', 'Bảo lưu', 'Đã tốt nghiệp'))
);

-- Lớp học
create table if not exists public.classes (
    id           varchar(50)  primary key,
    code         varchar(50)  not null,
    name         varchar(255) not null,
    subject      varchar(255) not null,
    teacher_id   varchar(50)  references public.teachers(id) on delete set null,
    tuition_fee  numeric(12,2) not null default 0,
    schedule_days integer[]   not null default '{}',
    shift_id     integer,
    start_time   varchar(10)  default '18:30',
    end_time     varchar(10)  default '20:30',
    is_recurring boolean      default true,
    meeting_link text,
    status       varchar(50)  not null default 'Đang mở',
    created_at   timestamptz  not null default now(),
    updated_at   timestamptz  not null default now(),
    constraint classes_status_check check (status in ('Đang mở', 'Sắp khai giảng', 'Đã kết thúc')),
    constraint classes_shift_id_check check (shift_id is null or shift_id > 0)
);

-- Học sinh thuộc lớp nào
create table if not exists public.class_students (
    class_id    varchar(50) not null references public.classes(id) on delete cascade,
    student_id  varchar(50) not null references public.students(id) on delete cascade,
    enrolled_at timestamptz not null default now(),
    primary key (class_id, student_id)
);

-- Buổi học cụ thể (thời khoá biểu)
create table if not exists public.schedule_slots (
    id             varchar(50)  primary key,
    class_id       varchar(50)  not null references public.classes(id) on delete cascade,
    teacher_id     varchar(50)  references public.teachers(id) on delete set null,
    date           date         not null,
    shift_id       integer      not null default 1,
    start_time     varchar(10)  not null,
    end_time       varchar(10)  not null,
    subject        varchar(255) not null,
    topic          text,
    meeting_link   text,
    status         varchar(50)  not null default 'Đã lên lịch',
    checkin_time   varchar(10),
    checkout_time  varchar(10),
    checkin_status varchar(30),
    checkin_method varchar(30),
    checkin_note   text,
    created_at     timestamptz  not null default now(),
    updated_at     timestamptz  not null default now(),
    constraint schedule_slots_status_check check (status in ('Đã lên lịch', 'Đã hoàn thành', 'Đã hủy', 'Đổi lịch')),
    constraint schedule_slots_shift_id_check check (shift_id > 0),
    constraint schedule_slots_checkin_status_check check (checkin_status is null or checkin_status in ('Chưa chấm công', 'Đúng giờ', 'Đi muộn')),
    constraint schedule_slots_checkin_method_check check (checkin_method is null or checkin_method in ('TEACHER_SELF', 'ADMIN', 'SYSTEM'))
);

-- Đăng ký buổi lẻ: học sinh đặt một buổi cụ thể, không theo ca dài hạn
create table if not exists public.student_session_bookings (
    id         varchar(50) primary key,
    student_id varchar(50) not null references public.students(id) on delete cascade,
    slot_id    varchar(50) not null references public.schedule_slots(id) on delete cascade,
    status     varchar(20) not null default 'Đã đăng ký',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint student_session_bookings_status_check
        check (status in ('Đã đăng ký', 'Đã hủy', 'Đã học')),
    constraint student_session_bookings_unique unique (student_id, slot_id)
);

-- Điểm danh từng học sinh trong từng buổi
create table if not exists public.attendance_records (
    id               varchar(50) primary key,
    schedule_slot_id varchar(50) not null references public.schedule_slots(id) on delete cascade,
    class_id         varchar(50) not null references public.classes(id) on delete cascade,
    student_id       varchar(50) not null references public.students(id) on delete cascade,
    date             date        not null,
    status           varchar(50) not null,
    checkin_time     varchar(20),
    note             text,
    original_slot_id varchar(50),
    makeup_reason    text,
    method           varchar(30) default 'MANUAL',
    updated_by       varchar(50) not null,
    updated_at       timestamptz not null default now(),
    constraint attendance_records_status_check check (status in ('Có mặt', 'Vắng có phép', 'Vắng không phép', 'Đi muộn', 'Điểm danh bù')),
    constraint attendance_records_method_check check (method is null or method in ('STUDENT_QUICK', 'MANUAL', 'SYSTEM', 'BOT'))
);

-- Đơn từ của học sinh (xin nghỉ, đổi lịch)
create table if not exists public.class_requests (
    id                      varchar(50) primary key,
    student_id              varchar(50) not null references public.students(id) on delete cascade,
    class_id                varchar(50) not null references public.classes(id) on delete cascade,
    schedule_slot_id        varchar(50) not null references public.schedule_slots(id) on delete cascade,
    type                    varchar(20) not null,
    reason                  text        not null,
    target_schedule_slot_id varchar(50) references public.schedule_slots(id) on delete set null,
    status                  varchar(20) not null default 'CHỜ_DUYỆT',
    reviewed_by             varchar(50),
    review_note             text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint class_requests_type_check check (type in ('XIN_NGHI', 'DOI_LICH')),
    constraint class_requests_status_check check (status in ('CHỜ_DUYỆT', 'ĐÃ_DUYỆT', 'TỪ_CHỐI'))
);

-- Hoá đơn học phí
-- class_id để dạng chuỗi tự do vì hoá đơn mua gói dùng mã quy ước 'CHUNG'.
create table if not exists public.tuition_invoices (
    id               varchar(50) primary key,
    student_id       varchar(50) not null references public.students(id) on delete cascade,
    class_id         varchar(50),
    title            varchar(255) not null,
    amount           numeric(12,2) not null default 0,
    paid_amount      numeric(12,2) not null default 0,
    remaining_amount numeric(12,2) not null default 0,
    due_date         date        not null,
    package_id       varchar(50),
    session_count    integer     default 0,
    used_sessions    integer     default 0,
    status           varchar(50) not null,
    paid_date        date,
    payment_method   varchar(50),
    transaction_code varchar(100),
    note             text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint tuition_invoices_status_check check (status in ('Đã nộp', 'Còn nợ', 'Quá hạn', 'Miễn giảm', 'Đã hủy', 'DA_NOP', 'CON_NO')),
    constraint tuition_invoices_payment_method_check check (payment_method is null or payment_method in ('Chuyển khoản QR', 'Tiền mặt', 'Thẻ ngân hàng'))
);

-- Bảng lương giáo viên theo tháng
create table if not exists public.teacher_payroll_periods (
    id          varchar(50) primary key,
    teacher_id  varchar(50) not null references public.teachers(id) on delete cascade,
    month       varchar(10) not null,
    total_slots integer     not null default 0,
    total_hours numeric(8,2) not null default 0,
    hourly_rate numeric(12,2) not null default 0,
    gross_salary numeric(12,2) not null default 0,
    bonus       numeric(12,2) not null default 0,
    deduction   numeric(12,2) not null default 0,
    net_salary  numeric(12,2) not null default 0,
    status      varchar(50) not null default 'Tạm tính',
    paid_date   date,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint teacher_payroll_periods_status_check check (status in ('Đã chốt', 'Đã thanh toán', 'Tạm tính'))
);

-- Nhật ký thao tác
create table if not exists public.audit_logs (
    id              varchar(50) primary key,
    user_id         varchar(50) not null,
    user_name       varchar(255) not null,
    user_role       varchar(50) not null,
    action          varchar(50) not null,
    target_resource varchar(50) not null,
    target_id       varchar(50) not null,
    details         text not null,
    old_value       text,
    new_value       text,
    ip_address      varchar(50),
    timestamp       timestamptz not null default now()
);

-- Thông báo trong ứng dụng
create table if not exists public.notifications (
    id                varchar(50) primary key default 'NOTIF_' || uuid_generate_v4(),
    recipient_role    varchar(20),
    recipient_user_id varchar(50) references public.users(id) on delete cascade,
    title             varchar(255) not null,
    message           text not null,
    type              varchar(50) not null,
    link              text,
    is_read           boolean not null default false,
    created_at        timestamptz not null default now(),
    constraint notifications_recipient_role_check check (recipient_role is null or recipient_role in ('ALL', 'ADMIN', 'TEACHER', 'STUDENT')),
    constraint notifications_type_check check (type in ('INFO', 'SUCCESS', 'WARNING', 'SCHEDULE', 'PAYMENT', 'REQUEST'))
);

-- Gói combo: số tiền tương ứng số buổi học
create table if not exists public.session_packages (
    id            varchar(50) primary key,
    name          varchar(255) not null,
    session_count integer not null default 0,
    price         numeric(12,2) not null default 0,
    description   text,
    is_active     boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint session_packages_session_count_check check (session_count >= 0),
    constraint session_packages_price_check check (price >= 0)
);

-- Danh mục ca học
create table if not exists public.time_shifts (
    id             serial primary key,
    name           varchar(100) not null,
    start_time     varchar(10)  not null,
    end_time       varchar(10)  not null,
    duration_hours numeric(4,1) not null default 2.0,
    is_active      boolean      not null default true,
    sort_order     integer      not null default 1,
    created_at     timestamptz  default now(),
    updated_at     timestamptz  default now()
);

-- ============================================================================
-- 2. BỔ SUNG CỘT CÒN THIẾU (an toàn khi chạy trên database cũ)
-- ============================================================================

alter table public.students
    add column if not exists avatar_url                text,
    add column if not exists parent_phone              varchar(50),
    add column if not exists assignment_url            text,
    add column if not exists home_town                 varchar(255),
    add column if not exists grade_level               varchar(50),
    add column if not exists target_university         varchar(100),
    add column if not exists custom_university         varchar(255),
    add column if not exists exam_block                varchar(20),
    add column if not exists study_goal                varchar(255),
    add column if not exists facebook_url              text,
    add column if not exists other_notes               text,
    add column if not exists registered_date           date,
    add column if not exists total_sessions_in_month   integer default 12,
    add column if not exists attended_sessions_in_month integer default 0,
    add column if not exists absent_sessions_in_month  integer default 0,
    add column if not exists remaining_sessions        integer default 12;

-- Đơn giá mỗi ca dạy của giáo viên (dùng để tính lương theo ca).
-- Trang nhân sự cho nhập và lưu giá trị này, nên bảng phải có cột tương ứng.
alter table public.teachers
    add column if not exists rate_per_session numeric(12,2) default 0;

alter table public.classes
    add column if not exists start_time   varchar(10) default '18:30',
    add column if not exists end_time     varchar(10) default '20:30',
    add column if not exists is_recurring boolean     default true;

alter table public.schedule_slots
    add column if not exists checkin_time   varchar(10),
    add column if not exists checkout_time  varchar(10),
    add column if not exists checkin_status varchar(30),
    add column if not exists checkin_method varchar(30),
    add column if not exists checkin_note   text;

alter table public.attendance_records
    add column if not exists original_slot_id varchar(50),
    add column if not exists makeup_reason    text,
    add column if not exists method           varchar(30) default 'MANUAL';

alter table public.tuition_invoices
    add column if not exists package_id    varchar(50),
    add column if not exists session_count integer default 0,
    add column if not exists used_sessions integer default 0,
    add column if not exists note          text;

-- ============================================================================
-- 3. CHUẨN HOÁ RÀNG BUỘC
-- ============================================================================

-- Hồ sơ học sinh có thể để trống ngày sinh và địa chỉ.
alter table public.students alter column date_of_birth drop not null;
alter table public.students alter column address       drop not null;

-- Giáo viên có thể bị gỡ khỏi lớp/buổi học, nên các cột này phải cho phép null.
alter table public.classes        alter column teacher_id drop not null;
alter table public.schedule_slots alter column teacher_id drop not null;

-- Hoá đơn mua gói dùng mã lớp quy ước 'CHUNG' nên bỏ khoá ngoại tới classes.
alter table public.tuition_invoices drop constraint if exists tuition_invoices_class_id_fkey;
alter table public.tuition_invoices alter column class_id drop not null;

-- Người duyệt đơn / người cập nhật điểm danh lưu dạng mã tự do, giống audit_logs.
alter table public.class_requests       drop constraint if exists class_requests_reviewed_by_fkey;
alter table public.attendance_records   drop constraint if exists attendance_records_updated_by_fkey;

-- Ràng buộc giá trị hợp lệ: xoá rồi tạo lại để database cũ nhận định nghĩa mới.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in ('ADMIN', 'TEACHER', 'STUDENT'));

alter table public.teachers drop constraint if exists teachers_status_check;
alter table public.teachers add constraint teachers_status_check check (status in ('Đang dạy', 'Nghỉ phép'));

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check check (status in ('Đang học', 'Tạm dừng', 'Đã nghỉ học', 'Bảo lưu', 'Đã tốt nghiệp'));

alter table public.students drop constraint if exists students_gender_check;
alter table public.students add constraint students_gender_check check (gender in ('Nam', 'Nữ'));

alter table public.classes drop constraint if exists classes_status_check;
alter table public.classes add constraint classes_status_check check (status in ('Đang mở', 'Sắp khai giảng', 'Đã kết thúc'));

alter table public.schedule_slots drop constraint if exists schedule_slots_status_check;
alter table public.schedule_slots add constraint schedule_slots_status_check check (status in ('Đã lên lịch', 'Đã hoàn thành', 'Đã hủy', 'Đổi lịch'));

alter table public.schedule_slots drop constraint if exists schedule_slots_checkin_status_check;
alter table public.schedule_slots add constraint schedule_slots_checkin_status_check check (checkin_status is null or checkin_status in ('Chưa chấm công', 'Đúng giờ', 'Đi muộn'));

alter table public.schedule_slots drop constraint if exists schedule_slots_checkin_method_check;
alter table public.schedule_slots add constraint schedule_slots_checkin_method_check check (checkin_method is null or checkin_method in ('TEACHER_SELF', 'ADMIN', 'SYSTEM'));

alter table public.attendance_records drop constraint if exists attendance_records_status_check;
alter table public.attendance_records add constraint attendance_records_status_check check (status in ('Có mặt', 'Vắng có phép', 'Vắng không phép', 'Đi muộn', 'Điểm danh bù'));

alter table public.attendance_records drop constraint if exists attendance_records_method_check;
alter table public.attendance_records add constraint attendance_records_method_check check (method is null or method in ('STUDENT_QUICK', 'MANUAL', 'SYSTEM', 'BOT'));

alter table public.class_requests drop constraint if exists class_requests_type_check;
alter table public.class_requests add constraint class_requests_type_check check (type in ('XIN_NGHI', 'DOI_LICH'));

alter table public.class_requests drop constraint if exists class_requests_status_check;
alter table public.class_requests add constraint class_requests_status_check check (status in ('CHỜ_DUYỆT', 'ĐÃ_DUYỆT', 'TỪ_CHỐI'));

alter table public.tuition_invoices drop constraint if exists tuition_invoices_status_check;
alter table public.tuition_invoices add constraint tuition_invoices_status_check check (status in ('Đã nộp', 'Còn nợ', 'Quá hạn', 'Miễn giảm', 'Đã hủy', 'DA_NOP', 'CON_NO'));

alter table public.tuition_invoices drop constraint if exists tuition_invoices_payment_method_check;
alter table public.tuition_invoices add constraint tuition_invoices_payment_method_check check (payment_method is null or payment_method in ('Chuyển khoản QR', 'Tiền mặt', 'Thẻ ngân hàng'));

alter table public.teacher_payroll_periods drop constraint if exists teacher_payroll_periods_status_check;
alter table public.teacher_payroll_periods add constraint teacher_payroll_periods_status_check check (status in ('Đã chốt', 'Đã thanh toán', 'Tạm tính'));

alter table public.notifications drop constraint if exists notifications_recipient_role_check;
alter table public.notifications add constraint notifications_recipient_role_check check (recipient_role is null or recipient_role in ('ALL', 'ADMIN', 'TEACHER', 'STUDENT'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('INFO', 'SUCCESS', 'WARNING', 'SCHEDULE', 'PAYMENT', 'REQUEST'));

-- Khoá duy nhất dùng cho upsert của ứng dụng.
alter table public.attendance_records drop constraint if exists uq_attendance_slot_student;
alter table public.attendance_records add constraint uq_attendance_slot_student unique (schedule_slot_id, student_id);

alter table public.teacher_payroll_periods drop constraint if exists uq_teacher_payroll_month;
alter table public.teacher_payroll_periods add constraint uq_teacher_payroll_month unique (teacher_id, month);

create unique index if not exists uq_users_username    on public.users (username);
create unique index if not exists uq_classes_code      on public.classes (code);

-- ============================================================================
-- 4. CHỈ MỤC
-- ============================================================================

create index if not exists idx_users_role               on public.users (role);
create index if not exists idx_users_is_active          on public.users (is_active);
create index if not exists idx_teachers_status          on public.teachers (status);
create index if not exists idx_students_status          on public.students (status);
create index if not exists idx_classes_teacher_id       on public.classes (teacher_id);
create index if not exists idx_classes_status           on public.classes (status);
create index if not exists idx_class_students_class_id  on public.class_students (class_id);
create index if not exists idx_class_students_student_id on public.class_students (student_id);
create index if not exists idx_schedule_slots_class_id  on public.schedule_slots (class_id);
create index if not exists idx_schedule_slots_teacher_id on public.schedule_slots (teacher_id);
create index if not exists idx_schedule_slots_date      on public.schedule_slots (date);
create index if not exists idx_schedule_slots_checkin_status on public.schedule_slots (checkin_status);
create index if not exists idx_attendance_slot_id       on public.attendance_records (schedule_slot_id);
create index if not exists idx_attendance_class_id      on public.attendance_records (class_id);
create index if not exists idx_attendance_student_id    on public.attendance_records (student_id);
create index if not exists idx_attendance_date          on public.attendance_records (date);
create index if not exists idx_session_bookings_student on public.student_session_bookings (student_id);
create index if not exists idx_session_bookings_slot    on public.student_session_bookings (slot_id);
create index if not exists idx_session_bookings_status  on public.student_session_bookings (status);
create index if not exists idx_class_requests_student_id on public.class_requests (student_id);
create index if not exists idx_class_requests_class_id  on public.class_requests (class_id);
create index if not exists idx_class_requests_status    on public.class_requests (status);
create index if not exists idx_tuition_invoices_student_id on public.tuition_invoices (student_id);
create index if not exists idx_tuition_invoices_class_id on public.tuition_invoices (class_id);
create index if not exists idx_tuition_invoices_status  on public.tuition_invoices (status);
create index if not exists idx_payroll_teacher_id       on public.teacher_payroll_periods (teacher_id);
create index if not exists idx_payroll_month            on public.teacher_payroll_periods (month);
create index if not exists idx_audit_logs_user_id       on public.audit_logs (user_id);
create index if not exists idx_audit_logs_timestamp     on public.audit_logs (timestamp desc);
create index if not exists idx_audit_logs_action        on public.audit_logs (action);
create index if not exists idx_notifications_recipient_user on public.notifications (recipient_user_id);
create index if not exists idx_notifications_recipient_role on public.notifications (recipient_role);
create index if not exists idx_notifications_is_read    on public.notifications (is_read);
create index if not exists idx_session_packages_active  on public.session_packages (is_active);

-- ============================================================================
-- 5. ĐỒNG BỘ TÊN GIỮA USERS VÀ HỒ SƠ
-- Sửa tên ở bất kỳ đâu cũng tự lan sang bảng còn lại.
-- ============================================================================

create or replace function public.sync_user_to_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if pg_trigger_depth() > 1 then
        return new;
    end if;

    if new.role = 'TEACHER' then
        update public.teachers
           set name = new.name,
               updated_at = now()
         where id = new.id;
    end if;

    if new.role = 'STUDENT' then
        update public.students
           set name = new.name
         where id = new.id;
    end if;

    return new;
end;
$$;

create or replace function public.sync_profile_to_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if pg_trigger_depth() > 1 then
        return new;
    end if;

    update public.users
       set name = new.name,
           updated_at = now()
     where id = new.id;

    return new;
end;
$$;

drop trigger if exists trg_sync_user_to_profiles on public.users;
create trigger trg_sync_user_to_profiles
    after update of name on public.users
    for each row execute function public.sync_user_to_profiles();

drop trigger if exists trg_sync_teacher_to_user on public.teachers;
create trigger trg_sync_teacher_to_user
    after update of name on public.teachers
    for each row execute function public.sync_profile_to_user();

drop trigger if exists trg_sync_student_to_user on public.students;
create trigger trg_sync_student_to_user
    after update of name on public.students
    for each row execute function public.sync_profile_to_user();

-- Hàm sinh mã ca học: max số trong 'SCHxxxx' mà không phải đọc cả bảng.
-- LƯU Ý: application KHÔNG còn gọi hàm này (xem SupabaseRepository.getMaxScheduleSlotNumber
-- — dùng truy vấn REST vì DB production chưa có hàm, gây 500 khi tạo lịch).
-- Giữ ở đây cho DB mới và cho các script vận hành chạy tay.
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

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- Bật RLS, không tạo policy: service_role (backend) vẫn chạy bình thường,
-- còn anon/authenticated không đọc hay ghi được gì qua PostgREST.
-- ============================================================================

alter table public.users                  enable row level security;
alter table public.teachers               enable row level security;
alter table public.students               enable row level security;
alter table public.classes                enable row level security;
alter table public.class_students         enable row level security;
alter table public.schedule_slots         enable row level security;
alter table public.attendance_records     enable row level security;
alter table public.class_requests         enable row level security;
alter table public.tuition_invoices       enable row level security;
alter table public.teacher_payroll_periods enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.notifications          enable row level security;
alter table public.session_packages       enable row level security;
alter table public.time_shifts            enable row level security;
alter table public.student_session_bookings enable row level security;

-- ============================================================================
-- 7. DỮ LIỆU DANH MỤC NỀN
-- ============================================================================

-- Ca học cố định (id 1..5 khớp TIME_SHIFTS trong src/types/schedule.ts)
insert into public.time_shifts (id, name, start_time, end_time, duration_hours, is_active, sort_order) values
    (1, 'Ca 1 (08:00 - 10:00)', '08:00', '10:00', 2.0, true, 1),
    (2, 'Ca 2 (10:15 - 12:15)', '10:15', '12:15', 2.0, true, 2),
    (3, 'Ca 3 (13:30 - 15:30)', '13:30', '15:30', 2.0, true, 3),
    (4, 'Ca 4 (15:45 - 17:45)', '15:45', '17:45', 2.0, true, 4),
    (5, 'Ca 5 (18:30 - 20:30)', '18:30', '20:30', 2.0, true, 5)
on conflict (id) do update set
    name           = excluded.name,
    start_time     = excluded.start_time,
    end_time       = excluded.end_time,
    duration_hours = excluded.duration_hours,
    is_active      = excluded.is_active,
    sort_order     = excluded.sort_order,
    updated_at     = now();

do $$
begin
    perform setval('public.time_shifts_id_seq', greatest((select max(id) from public.time_shifts), 5));
exception when others then
    null; -- sequence chưa tồn tại thì bỏ qua
end;
$$;

-- Gói combo: số tiền tương ứng số buổi học
insert into public.session_packages (id, name, session_count, price, description, is_active) values
    ('PKG10', 'Gói Cơ Bản (10 buổi)',  10, 1000000, 'Gói khởi đầu, làm quen lộ trình và phương pháp học.', true),
    ('PKG20', 'Gói Nâng Cao (20 buổi)', 20, 1800000, 'Học đều đặn, có bài tập dự án và buổi cố vấn riêng.', true),
    ('PKG30', 'Gói Chuyên Sâu (30 buổi)', 30, 2500000, 'Lộ trình dài, bám sát mục tiêu đầu ra.', true),
    ('PKG50', 'Gói Master (50 buổi)',   50, 3900000, 'Gói dài hạn, tạm ngừng nhận đăng ký.', false)
on conflict (id) do update set
    name          = excluded.name,
    session_count = excluded.session_count,
    price         = excluded.price,
    description   = excluded.description,
    is_active     = excluded.is_active,
    updated_at    = now();

-- ============================================================================
-- 8. HOÀN TẤT
-- ============================================================================

commit;

-- Làm PostgREST đọc lại schema ngay, không cần chờ cache hết hạn.
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Tài khoản quản trị đầu tiên — chạy riêng, chỉ một lần.
-- Hash bên dưới là SHA-256 của 'admin123'. Đổi mật khẩu ngay sau khi đăng nhập.
-- ----------------------------------------------------------------------------
-- insert into public.users (id, username, password_hash, role, name, is_active)
-- values (
--     'ADMIN001', 'admin',
--     '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
--     'ADMIN', 'Quản trị viên', true
-- )
-- on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Kiểm tra nhanh sau khi chạy.
-- ----------------------------------------------------------------------------
-- select table_name from information_schema.tables
--  where table_schema = 'public' order by table_name;
