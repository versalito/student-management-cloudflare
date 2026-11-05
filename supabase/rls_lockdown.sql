-- =============================================================================
-- RLS LOCKDOWN — chặn anon/authenticated đọc dữ liệu qua PostgREST
--
-- Bối cảnh: NEXT_PUBLIC_SUPABASE_ANON_KEY nằm trong wrangler.toml (public) và
-- mọi bảng public đang trả dữ liệu cho key đó, gồm users (password_hash),
-- students/teachers (PII), tuition_invoices, audit_logs.
--
-- Backend của app chỉ dùng service_role (src/lib/supabase.ts), là role có
-- BYPASSRLS, nên sau khi chạy script này app vẫn hoạt động bình thường.
-- Không có component nào ở browser gọi thẳng Supabase.
--
-- Chạy 1 lần trong Supabase SQL Editor (hoặc psql). Idempotent: chạy lại vô hại.
-- Sau khi chạy, kiểm chứng: node scripts/verify-rls.mjs
-- =============================================================================

begin;

-- 1. Bật RLS cho mọi bảng/view ở schema public (không policy = từ chối tất cả
--    với role không có BYPASSRLS). Dùng vòng lặp để không bỏ sót bảng thêm sau này.
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')   -- table, partitioned, view, matview, foreign
  loop
    if r.relkind = 'v' then
      execute format('alter view public.%I set (security_invoker = true)', r.relname);
    else
      execute format('alter table public.%I enable row level security', r.relname);
      execute format('alter table public.%I force row level security', r.relname);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- 2. Chặn cả sequence và function (RPC) — anon không cần cả hai.
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 3. Chặn các object tạo mới trong tương lai (Postgres 15+; bỏ qua nếu lỗi quyền).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;

-- 4. Kiểm tra nhanh ngay trong SQL Editor: phải trả về 0 dòng.
--    (SQL Editor chạy bằng role postgres nên vẫn đọc được để đối chiếu.)
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public' and rowsecurity = false;
