-- ============================================================================
-- KHÔI PHỤC TOÀN BỘ MẬT KHẨU VỀ MẬT KHẨU MẶC ĐỊNH GỐC
-- ----------------------------------------------------------------------------
-- Chạy script này trong Supabase Dashboard -> SQL Editor:
--   - ADMIN     : admin123
--   - GIÁO VIÊN : teacher123  (hoặc 123456 nếu dùng lựa chọn bên dưới)
--   - HỌC VIÊN  : student123  (hoặc 123456 nếu dùng lựa chọn bên dưới)
-- ============================================================================

begin;

-- 1. Quản trị viên (ADMIN) -> mật khẩu: admin123
update public.users 
set password_hash = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    is_active = true
where role = 'ADMIN';

-- 2. Giáo viên (TEACHER) -> mật khẩu: teacher123
update public.users 
set password_hash = 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416',
    is_active = true
where role = 'TEACHER';

-- 3. Học viên (STUDENT) -> mật khẩu: student123
update public.users 
set password_hash = '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    is_active = true
where role = 'STUDENT';

commit;

-- ============================================================================
-- TUỲ CHỌN PHỤ: NẾU MUỐN TẤT CẢ GIÁO VIÊN & HỌC SINH DÙNG CHUNG '123456'
-- (Bỏ comment 4 dòng dưới nếu muốn dùng 123456 cho toàn bộ GV và HS):
-- update public.users 
-- set password_hash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'
-- where role in ('TEACHER', 'STUDENT');
-- ============================================================================
