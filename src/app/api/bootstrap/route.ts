import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { authenticate } from '@/lib/auth/session';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { withCacheHeader, withReferenceCache } from '@/lib/cache/referenceCache';

export const dynamic = 'force-dynamic';

/**
 * BFF/bootstrap: gộp các request tham chiếu của một màn hình vào **một** response.
 *
 * Trước đây `/admin/calendar` gọi 4 endpoint song song (schedule, teachers, classes,
 * students) — mỗi request là một cold path riêng trong Worker (middleware, parse,
 * session, cold repo) dù dữ liệu dùng lại y nhau. Gộp ở server còn cho phép dùng
 * chung một lần đọc `classes` cho cả danh sách lớp lẫn lịch học, và chỉ nạp đúng
 * học sinh đã ghi danh thay vì 400 dòng đầu của bảng `students`.
 *
 * `scope` là danh sách thành phần cần trả, phân tách bằng dấu phẩy; trang chỉ
 * nhận đúng phần mình dùng để payload không phình.
 */
const ALL_PARTS = ['classes', 'teachers', 'shifts', 'students', 'slots'] as const;
type BootstrapPart = (typeof ALL_PARTS)[number];

function parseParts(raw: string | null): BootstrapPart[] {
  if (!raw) return [...ALL_PARTS];
  const wanted = new Set(
    raw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  );
  const parts = ALL_PARTS.filter((p) => wanted.has(p));
  return parts.length > 0 ? parts : [...ALL_PARTS];
}

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const parts = parseParts(searchParams.get('scope'));
  const date = searchParams.get('date') || undefined;

  const wants = new Set<BootstrapPart>(parts);

  try {
    // Tham chiếu đọc qua cache; `slots` và `students` phụ thuộc ngày/ghi danh nên đọc tươi.
    const [classesResult, teachersResult, shiftsResult] = await Promise.all([
      // `students` cần `classes` để biết ai đã ghi danh, kể cả khi trang không
      // xin danh sách lớp — nạp ở đây rồi chỉ trả về khi được yêu cầu.
      wants.has('classes') || wants.has('slots') || wants.has('students')
        ? withReferenceCache('classes', 'all', () => repo.getAllClasses())
        : Promise.resolve(null),
      wants.has('teachers') || wants.has('slots')
        ? withReferenceCache('teachers', 'all', () => repo.getAllTeachers())
        : Promise.resolve(null),
      wants.has('shifts')
        ? withReferenceCache('shifts', 'all', () => repo.getAllTimeShifts())
        : Promise.resolve(null),
    ]);

    const classes = classesResult?.value ?? null;
    const teachers = teachersResult?.value ?? null;

    const body: Record<string, unknown> = {};
    const statuses: string[] = [];

    if (wants.has('classes')) {
      body.classes = classes ?? [];
      statuses.push(classesResult ? classesResult.status : 'bypass');
    }
    if (wants.has('teachers')) {
      body.teachers = teachers ?? [];
      statuses.push(teachersResult ? teachersResult.status : 'bypass');
    }
    if (wants.has('shifts')) {
      body.shifts = shiftsResult?.value ?? [];
      statuses.push(shiftsResult ? shiftsResult.status : 'bypass');
    }

    const tasks: Promise<void>[] = [];

    if (wants.has('slots')) {
      tasks.push(
        loadScheduleView(
          { date, studentId: searchParams.get('studentId') || undefined },
          { classes: classes ?? undefined, teachers: teachers ?? undefined }
        ).then((view) => {
          body.slots = view.slots;
        })
      );
    }

    if (wants.has('students')) {
      tasks.push(
        // Chỉ nạp học sinh thuộc các lớp đang hiển thị: bảng `students` lớn hơn
        // nhiều so với số học sinh thực sự xuất hiện trên màn hình.
        (async () => {
          const enrolledIds = Array.from(
            new Set(
              (classes ?? []).flatMap((cls) => cls.studentIds || [])
            )
          );
          const full = await repo.getStudentsByIds(enrolledIds);
          // Chỉ trả trường màn hình dùng: cả hồ sơ 400 học sinh là ~90 KB
          // trong khi lịch học chỉ đọc id/name/phone/avatar.
          body.students = full.map(({ id, name, phone, avatarUrl }) => ({
            id,
            name,
            phone,
            avatarUrl,
          }));
        })()
      );
    }

    await Promise.all(tasks);

    const response = NextResponse.json(body);
    // Gộp nhiều nguồn: chỉ báo `HIT` khi mọi phần đọc đều từ cache.
    if (statuses.length > 0) {
      const status = statuses.every((s) => s === 'hit')
        ? 'HIT'
        : statuses.every((s) => s === 'bypass')
          ? 'BYPASS'
          : 'MISS';
      withCacheHeader(response, status.toLowerCase() as 'hit' | 'miss' | 'bypass');
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải dữ liệu khởi tạo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
