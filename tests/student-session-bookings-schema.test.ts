import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingBookingsTable } from '../src/repositories/SupabaseRepository';

/**
 * Hồi quy cho sự cố production 2026-11-07: DB Supabase chưa chạy migration
 * `update_2026-11-06-student-session-bookings.sql`, nên mọi đường đọc gọi
 * `getSessionBookings` (thời khoá biểu, điểm danh, buổi lẻ) cùng 500 và giao
 * diện học viên hiện nguyên văn "Could not find the table ...".
 *
 * Chốt lại phần nhận diện lỗi: chỉ đúng lỗi "thiếu bảng" mới được coi là chưa
 * có booking nào, mọi lỗi khác vẫn phải nổi lên.
 */

test('Bookings schema: nhận diện đúng lỗi thiếu bảng của PostgREST', () => {
  assert.equal(isMissingBookingsTable(null), false);
  assert.equal(isMissingBookingsTable({ code: 'PGRST205' }), true);
  assert.equal(
    isMissingBookingsTable({
      message: "Could not find the table 'public.student_session_bookings' in the schema cache",
    }),
    true
  );
});

test('Bookings schema: lỗi khác không bị nuốt thành "chưa có booking"', () => {
  assert.equal(
    isMissingBookingsTable({ code: 'PGRST301', message: 'JWT expired' }),
    false
  );
  assert.equal(
    isMissingBookingsTable({ message: 'duplicate key value violates unique constraint' }),
    false
  );
  // Thiếu bảng khác thì vẫn là lỗi thật, không được coi như buổi lẻ trống.
  assert.equal(
    isMissingBookingsTable({ message: "Could not find the table 'public.students' in the schema cache" }),
    false
  );
});
