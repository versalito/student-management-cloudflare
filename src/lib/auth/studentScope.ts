import { repo } from '@/repositories';


/**
 * Phạm vi học viên mà một giáo viên được đọc.
 *
 * Trước đây `isSelfOrStaff()` trả `true` cho MỌI giáo viên, nên `GET /api/students`
 * (không lọc) và `GET/PATCH /api/students/:id` mở toàn bộ hồ sơ học viên — gồm
 * số điện thoại, số phụ huynh, địa chỉ, ngày sinh — cho bất kỳ tài khoản TEACHER
 * nào, kể cả giáo viên không dạy lớp đó. Portal giáo viên chỉ cần học viên thuộc
 * lớp/ca mình phụ trách, nên phạm vi đúng là hợp của các ca đó.
 */
export async function getTeacherStudentIds(teacherId: string): Promise<Set<string>> {
  const [classes, sections] = await Promise.all([
    repo.getClassesByTeacherId(teacherId),
    repo.getSectionsByTeacherId(teacherId),
  ]);

  const ids = new Set<string>();
  for (const cls of classes) {
    for (const studentId of cls.studentIds || []) ids.add(studentId);
  }
  for (const section of sections) {
    for (const studentId of section.studentIds || []) ids.add(studentId);
  }
  return ids;
}

/** `true` nếu giáo viên dạy lớp/ca có học viên này. */
export async function teacherTeachesStudent(
  teacherId: string,
  studentId: string
): Promise<boolean> {
  const ids = await getTeacherStudentIds(teacherId);
  return ids.has(studentId);
}

/** Tập lớp mà giáo viên phụ trách (trực tiếp hoặc qua ca). */
export async function getTeacherClassIds(teacherId: string): Promise<Set<string>> {
  const [classes, sections] = await Promise.all([
    repo.getClassesByTeacherId(teacherId),
    repo.getSectionsByTeacherId(teacherId),
  ]);
  const ids = new Set<string>(classes.map((cls) => cls.id));
  for (const section of sections) ids.add(section.classId);
  return ids;
}

/** `true` nếu giáo viên phụ trách lớp (trực tiếp) hoặc ca thuộc lớp đó. */
export async function teacherTeachesClass(
  teacherId: string,
  classId: string
): Promise<boolean> {
  return (await getTeacherClassIds(teacherId)).has(classId);
}
