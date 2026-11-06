'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { TIME_SHIFTS, TimeShift } from '@/types/schedule';
import { timeToMinutes, formatTimeHM } from '@/utils/date';
import { getClassTimeRange } from '@/utils/schedule';
import {
  minuteToPercent,
  buildTimelineTicks,
  TIMELINE_START_MINUTES,
  TIMELINE_END_MINUTES,
} from '@/components/schedule/Timeline';
import {
  Card,
  Button,
  Badge,
  Field,
  Input,
  Select,
  Sheet,
  useToast,
  EmptyState,
  SearchInput,
  Pager,
} from '@/components/ui';
import {
  BookOpen,
  Users,
  UserCheck,
  Plus,
  Trash2,
  Edit3,
  Video,
  ExternalLink,
  Calendar,
  Clock,
  RotateCw,
  Sparkles,
  Settings2,
  Check,
} from 'lucide-react';

/** Nhãn thứ trong tuần theo quy ước dữ liệu: 2..7 = Thứ 2..Thứ 7, 8 = Chủ nhật. */
const WEEK_DAY_OPTIONS: { value: number; label: string; short: string }[] = [
  { value: 2, label: 'Thứ 2', short: 'T2' },
  { value: 3, label: 'Thứ 3', short: 'T3' },
  { value: 4, label: 'Thứ 4', short: 'T4' },
  { value: 5, label: 'Thứ 5', short: 'T5' },
  { value: 6, label: 'Thứ 6', short: 'T6' },
  { value: 7, label: 'Thứ 7', short: 'T7' },
  { value: 8, label: 'Chủ nhật', short: 'CN' },
];

/** Một ca học bổ sung khi khởi tạo lớp mới (lớp có thể gồm nhiều ca). */
type DraftSection = {
  shiftId: number;
  startTime: string;
  endTime: string;
  scheduleDays: number[];
  teacherId: string;
};

const createEmptySection = (teacherId: string): DraftSection => ({
  shiftId: 1,
  startTime: '18:30',
  endTime: '20:30',
  scheduleDays: [2, 4, 6],
  teacherId: teacherId || '',
});

export default function AdminClassesPage() {
  const toast = useToast();

  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [addClassLoading, setAddClassLoading] = useState(false);
  const [newClassFormData, setNewClassFormData] = useState({
    name: '',
    subject: '',
    teacherId: '',
    shiftId: 1,
    startTime: '18:30',
    endTime: '20:30',
    scheduleDays: [2, 4, 6] as number[],
    isRecurring: true,
    tuitionFee: 1500000,
    meetingLink: '',
    autoGenerateSchedule: true,
    generateMonths: 3,
  });
  // Các ca học bổ sung khi khởi tạo lớp (luôn giữ ít nhất một hàng).
  const [draftSections, setDraftSections] = useState<DraftSection[]>([]);

  // Sheet Lên lịch nhanh cho riêng 1 lớp
  const [quickScheduleClass, setQuickScheduleClass] = useState<ClassEntity | null>(null);
  const [quickScheduleStartDate, setQuickScheduleStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [quickScheduleEndDate, setQuickScheduleEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().split('T')[0];
  });
  const [quickScheduleStartTime, setQuickScheduleStartTime] = useState('18:30');
  const [quickScheduleEndTime, setQuickScheduleEndTime] = useState('20:30');
  const [quickScheduleDays, setQuickScheduleDays] = useState<number[]>([2, 4, 6]);
  const [quickScheduleOverwrite, setQuickScheduleOverwrite] = useState(false);
  const [quickScheduleSubmitting, setQuickScheduleSubmitting] = useState(false);

  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // Danh sách khung giờ gợi ý lấy từ hệ thống; nếu chưa tải được thì dùng bộ mặc định.
  const [shifts, setShifts] = useState<TimeShift[]>(TIME_SHIFTS);
  const [showShiftManager, setShowShiftManager] = useState(false);
  const [shiftDraft, setShiftDraft] = useState<TimeShift[]>([]);
  const [savingShifts, setSavingShifts] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // Sheet quản lý học viên của lớp
  const [selectedClass, setSelectedClass] = useState<ClassEntity | null>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [sections, setSections] = useState<ClassSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState('');
  // Lọc học viên theo thứ (null = tất cả). Chỉ áp dụng cho ca đang chọn.
  const [filterDay, setFilterDay] = useState<number | null>(null);
  // Popup thêm/sửa một ca trong lớp đã có
  const [editingSection, setEditingSection] = useState<ClassSection | null>(null);
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const [sectionFormLoading, setSectionFormLoading] = useState(false);
  const [sectionForm, setSectionForm] = useState({
    name: '',
    shiftId: 1,
    startTime: '18:30',
    endTime: '20:30',
    scheduleDays: [] as number[],
    teacherId: '',
  });

  // Sheet đổi giáo viên quản lý lớp
  const [changingTeacherClass, setChangingTeacherClass] = useState<ClassEntity | null>(null);
  const [changingTeacherLoading, setChangingTeacherLoading] = useState(false);
  const [newTeacherId, setNewTeacherId] = useState('');

  // Sheet sửa link phòng học trực tuyến
  const [editingMeetClass, setEditingMeetClass] = useState<ClassEntity | null>(null);
  const [savingMeetLink, setSavingMeetLink] = useState(false);
  const [meetLinkInput, setMeetLinkInput] = useState('');

  // Sheet xác nhận xoá lớp
  const [classToDelete, setClassToDelete] = useState<ClassEntity | null>(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // Sheet sửa thông tin / thời gian lớp học
  const [editingClass, setEditingClass] = useState<ClassEntity | null>(null);
  const [savingClassEdit, setSavingClassEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    subject: '',
    teacherId: '',
    startTime: '',
    endTime: '',
    scheduleDays: [] as number[],
    tuitionFee: 0,
    meetingLink: '',
  });

  const formatScheduleDays = (days?: number[]) => {
    if (!days || days.length === 0) return 'Chưa xếp thứ';
    const sorted = [...days].sort((a, b) => a - b);
    return sorted.map((d) => (d === 8 ? 'CN' : 'T' + d)).join(', ');
  };

  /** Thứ thực tế của một học sinh trong ca: ưu tiên thứ riêng, rỗng = theo đủ lịch ca. */
  const studentDaysInSection = (sec: ClassSection | undefined, studentId: string): number[] => {
    if (!sec) return [];
    const own = sec.studentScheduleDays?.[studentId];
    if (own && own.length > 0) return own;
    return sec.scheduleDays || [];
  };

  const loadData = async () => {
    try {
      const [clsRes, tcRes, shiftRes] = await Promise.all([
        fetch('/api/classes'),
        fetch('/api/teachers'),
        fetch('/api/shifts'),
      ]);
      const clsData = await clsRes.json();
      const tcData = await tcRes.json();
      setClasses(clsData.classes || []);
      setTeachers(tcData.teachers || []);
      try {
        const shiftData = await shiftRes.json();
        const loadedShifts: TimeShift[] = shiftData.shifts || [];
        if (loadedShifts.length > 0) setShifts(loadedShifts);
      } catch {
        // Giữ bộ khung giờ gợi ý mặc định nếu máy chủ chưa trả về danh sách.
      }
    } catch (e: any) {
      toast.error(e?.message || 'Không thể tải danh sách lớp học');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassFormData.name || !newClassFormData.subject || !newClassFormData.teacherId) {
      toast.error('Vui lòng điền đủ Tên lớp, Chuyên môn và Giảng viên');
      return;
    }

    setAddClassLoading(true);
    try {
      // Ca gốc lấy từ form; các ca bổ sung lấy từ draftSections (đã bỏ ca trống).
      const baseSection = {
        shiftId: newClassFormData.shiftId,
        startTime: newClassFormData.startTime,
        endTime: newClassFormData.endTime,
        scheduleDays: newClassFormData.scheduleDays,
        teacherId: newClassFormData.teacherId,
      };
      const extraSections = draftSections.filter(
        (s) => s.startTime && s.endTime && s.teacherId
      );
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newClassFormData,
          sections: [baseSection, ...extraSections],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Tạo lớp học mới thành công');
        setShowAddClassModal(false);
        setNewClassFormData({
          name: '',
          subject: '',
          teacherId: teachers[0]?.id || '',
          shiftId: 1,
          startTime: '18:30',
          endTime: '20:30',
          scheduleDays: [2, 4, 6],
          isRecurring: true,
          tuitionFee: 1500000,
          meetingLink: '',
          autoGenerateSchedule: true,
          generateMonths: 3,
        });
        setDraftSections([]);
        await loadData();
      } else {
        toast.error(data.error || 'Tạo lớp học thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi kết nối mạng');
    } finally {
      setAddClassLoading(false);
    }
  };

  const handleQuickSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickScheduleClass) return;
    setQuickScheduleSubmitting(true);

    try {
      const res = await fetch('/api/schedule/bulk-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classIds: [quickScheduleClass.id],
          startDate: quickScheduleStartDate,
          endDate: quickScheduleEndDate,
          startTime: quickScheduleStartTime,
          endTime: quickScheduleEndTime,
          shiftId: quickScheduleClass.shiftId || 1,
          scheduleDays: quickScheduleDays,
          overwriteExisting: quickScheduleOverwrite,

        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(
          'Đã lên lịch cho lớp ' + quickScheduleClass.name + ': tạo mới ' + data.summary.createdCount + ' ca'
        );
        setQuickScheduleClass(null);
      } else {
        toast.error(data.error || 'Lên lịch thất bại');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi mạng');
    } finally {
      setQuickScheduleSubmitting(false);
    }
  };

  const confirmDeleteClass = async () => {
    if (!classToDelete) return;
    setIsDeletingClass(true);
    try {
      const res = await fetch('/api/classes?id=' + classToDelete.id, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã xoá lớp học thành công');
        setClassToDelete(null);
        await loadData();
      } else {
        toast.error(data.error || 'Xoá lớp học thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    } finally {
      setIsDeletingClass(false);
    }
  };

  const openClassStudentsModal = async (cls: ClassEntity) => {
    setSelectedClass(cls);
    setModalLoading(true);
    setStudentSearch('');
    try {
      const allRes = await fetch('/api/students?limit=400');
      const secRes = await fetch('/api/classes/sections?classId=' + cls.id);
      const allData = await allRes.json();
      const secData = await secRes.json();
      const studentsList: Student[] = allData.students || [];
      const secList: ClassSection[] = secData.sections || [];
      setAllStudents(studentsList);
      setSections(secList);
      const firstSec = secList[0] || null;
      const selectedId = firstSec ? firstSec.id : '';
      setSelectedSectionId(selectedId);
      setFilterDay(null);
      setEnrolledStudents(
        firstSec
          ? studentsList.filter((s) => (firstSec.studentIds || []).includes(s.id))
          : studentsList.filter((s) => (cls.studentIds || []).includes(s.id))
      );
    } catch (e: any) {
      toast.error(e?.message || 'Không thể tải danh sách học viên');
    } finally {
      setModalLoading(false);
    }
  };

  const handleSectionChange = (sectionId: string) => {
    setSelectedSectionId(sectionId);
    setFilterDay(null);
    const sec = sections.find((x) => x.id === sectionId);
    setEnrolledStudents(sec ? allStudents.filter((s) => (sec.studentIds || []).includes(s.id)) : []);
  };

  const handleEnrollAction = async (studentId: string, action: 'ENROLL' | 'UNENROLL') => {
    if (!selectedClass || !selectedSectionId) return;
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: selectedClass.id,
          sectionId: selectedSectionId,
          studentId,
          action,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || (action === 'ENROLL' ? 'Đã thêm học viên vào ca' : 'Đã xoá học viên khỏi ca'));
        const updatedSections = sections.map((sec) => {
          if (sec.id !== selectedSectionId) return sec;
          let ids = [...(sec.studentIds || [])];
          if (action === 'ENROLL') {
            if (!ids.includes(studentId)) ids.push(studentId);
          } else {
            ids = ids.filter((id) => id !== studentId);
          }
          return { ...sec, studentIds: ids };
        });
        setSections(updatedSections);
        const unionIds = new Set<string>();
        updatedSections.forEach((sec) => (sec.studentIds || []).forEach((id) => unionIds.add(id)));
        const updatedCls = { ...selectedClass, studentIds: Array.from(unionIds) };
        setSelectedClass(updatedCls);
        const activeSec = updatedSections.find((sec) => sec.id === selectedSectionId);
        setEnrolledStudents(allStudents.filter((s) => (activeSec?.studentIds || []).includes(s.id)));
        setClasses((prev) => prev.map((c) => (c.id === updatedCls.id ? updatedCls : c)));
      } else {
        toast.error(data.error || 'Thao tác thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    }
  };

  /** Mở popup thêm/sửa một ca trong lớp đã chọn. */
  const openSectionForm = (sec: ClassSection | null) => {
    setEditingSection(sec);
    setSectionFormOpen(true);
    if (sec) {
      setSectionForm({
        name: sec.name || '',
        shiftId: sec.shiftId || 1,
        startTime: sec.startTime || '18:30',
        endTime: sec.endTime || '20:30',
        scheduleDays: sec.scheduleDays && sec.scheduleDays.length > 0 ? [...sec.scheduleDays] : [],
        teacherId: sec.teacherId || '',
      });
    } else {
      setSectionForm({
        name: '',
        shiftId: newClassFormData.shiftId,
        startTime: newClassFormData.startTime,
        endTime: newClassFormData.endTime,
        scheduleDays: newClassFormData.scheduleDays.length > 0
          ? [...newClassFormData.scheduleDays]
          : (selectedClass?.scheduleDays || []).length > 0
            ? [...(selectedClass?.scheduleDays || [])]
            : [],
        teacherId: selectedClass?.teacherId || teachers[0]?.id || '',
      });
    }
  };

  const applySectionShiftPreset = (shift: TimeShift) => {
    setSectionForm((prev) => ({
      ...prev,
      shiftId: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
    }));
  };

  const toggleSectionDay = (day: number) => {
    const selected = sectionForm.scheduleDays.includes(day);
    let updated = [...sectionForm.scheduleDays];
    if (selected) {
      if (updated.length <= 1) return;
      updated = updated.filter((d) => d !== day);
    } else {
      updated.push(day);
      updated.sort((a, b) => a - b);
    }
    setSectionForm((prev) => ({ ...prev, scheduleDays: updated }));
  };

  const saveSectionForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    const endMin = timeToMinutes(sectionForm.endTime);
    const startMin = timeToMinutes(sectionForm.startTime);
    if (endMin <= startMin) {
      toast.error('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    setSectionFormLoading(true);
    try {
      if (editingSection) {
        const res = await fetch('/api/classes/sections', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId: editingSection.id,
            name: sectionForm.name,
            shiftId: sectionForm.shiftId,
            startTime: sectionForm.startTime,
            endTime: sectionForm.endTime,
            scheduleDays: sectionForm.scheduleDays,
            teacherId: sectionForm.teacherId,
            syncFutureSlots: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || 'Cập nhật ca học thất bại');
          return;
        }
        toast.success(data.syncedSlotsCount > 0
          ? `Đã cập nhật ca và đồng bộ ${data.syncedSlotsCount} buổi tương lai`
          : 'Đã cập nhật ca học');
        setSections((prev) =>
          prev.map((sec) =>
            sec.id === editingSection.id
              ? {
                  ...sec,
                  name: data.section.name || sec.name,
                  shiftId: data.section.shiftId,
                  startTime: data.section.startTime,
                  endTime: data.section.endTime,
                  scheduleDays: data.section.scheduleDays,
                  teacherId: data.section.teacherId,
                }
              : sec
          )
        );
      } else {
        const res = await fetch('/api/classes/sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId: selectedClass.id,
            name: sectionForm.name || undefined,
            shiftId: sectionForm.shiftId,
            startTime: sectionForm.startTime,
            endTime: sectionForm.endTime,
            scheduleDays: sectionForm.scheduleDays,
            teacherId: sectionForm.teacherId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || 'Thêm ca học thất bại');
          return;
        }
        toast.success('Đã thêm ca học mới');
        setSections((prev) => [...prev, { ...data.section, studentIds: [] }]);
        setSelectedSectionId(data.section.id);
        setEnrolledStudents([]);
      }
      setEditingSection(null);
      setSectionFormOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi mạng');
    } finally {
      setSectionFormLoading(false);
    }
  };

  const deleteSection = async (sec: ClassSection) => {
    if (!selectedClass) return;
    if (!window.confirm(`Xóa ca "${sec.name || sec.id}"? Các buổi học tương lai của ca sẽ bị hủy.`)) return;
    try {
      const res = await fetch('/api/classes/sections?id=' + encodeURIComponent(sec.id), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Xóa ca học thất bại');
        return;
      }
      toast.success(data.message || 'Đã xóa ca học và hủy các buổi tương lai');
      const remaining = sections.filter((s) => s.id !== sec.id);
      setSections(remaining);
      if (selectedSectionId === sec.id) {
        const first = remaining[0] || null;
        setSelectedSectionId(first ? first.id : '');
        setEnrolledStudents(first ? allStudents.filter((s) => (first.studentIds || []).includes(s.id)) : []);
      }
      const unionIds = new Set<string>();
      remaining.forEach((s) => (s.studentIds || []).forEach((id) => unionIds.add(id)));
      const updatedCls = { ...selectedClass, studentIds: Array.from(unionIds) };
      setSelectedClass(updatedCls);
      setClasses((prev) => prev.map((c) => (c.id === updatedCls.id ? updatedCls : c)));
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi mạng');
    }
  };

  const handleSaveMeetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeetClass) return;
    setSavingMeetLink(true);
    try {
      const res = await fetch('/api/classes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: editingMeetClass.id,
          meetingLink: meetLinkInput,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã cập nhật liên kết phòng học trực tuyến');
        setClasses((prev) =>
          prev.map((c) => (c.id === editingMeetClass.id ? { ...c, meetingLink: meetLinkInput } : c))
        );
        setEditingMeetClass(null);
      } else {
        toast.error(data.error || 'Cập nhật liên kết thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    } finally {
      setSavingMeetLink(false);
    }
  };

  const handleChangeTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingTeacherClass || !newTeacherId) return;
    setChangingTeacherLoading(true);
    try {
      const res = await fetch('/api/classes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: changingTeacherClass.id,
          teacherId: newTeacherId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã đổi giáo viên quản lý lớp');
        setClasses((prev) =>
          prev.map((c) => (c.id === changingTeacherClass.id ? { ...c, teacherId: newTeacherId } : c))
        );
        setChangingTeacherClass(null);
      } else {
        toast.error(data.error || 'Đổi giáo viên thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    } finally {
      setChangingTeacherLoading(false);
    }
  };

  const openClassEditModal = (cls: ClassEntity) => {
    setEditingClass(cls);
    setEditForm({
      name: cls.name || '',
      subject: cls.subject || '',
      teacherId: cls.teacherId || '',
      startTime: cls.startTime || '',
      endTime: cls.endTime || '',
      scheduleDays: cls.scheduleDays && cls.scheduleDays.length > 0 ? [...cls.scheduleDays] : [],
      tuitionFee: cls.tuitionFee || 0,
      meetingLink: cls.meetingLink || '',
    });
  };

  const handleSaveClassEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    setSavingClassEdit(true);
    try {
      const res = await fetch('/api/classes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: editingClass.id,
          name: editForm.name,
          subject: editForm.subject,
          teacherId: editForm.teacherId,
          startTime: editForm.startTime,
          endTime: editForm.endTime,
          scheduleDays: editForm.scheduleDays,
          tuitionFee: Number(editForm.tuitionFee) || 0,
          meetingLink: editForm.meetingLink,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã cập nhật thông tin lớp học');
        setClasses((prev) =>
          prev.map((c) =>
            c.id === editingClass.id
              ? {
                  ...c,
                  name: editForm.name,
                  subject: editForm.subject,
                  teacherId: editForm.teacherId,
                  startTime: editForm.startTime,
                  endTime: editForm.endTime,
                  scheduleDays: editForm.scheduleDays,
                  tuitionFee: Number(editForm.tuitionFee) || 0,
                  meetingLink: editForm.meetingLink,
                }
              : c
          )
        );
        setEditingClass(null);
      } else {
        toast.error(data.error || 'Cập nhật lớp học thất bại');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi mạng');
    } finally {
      setSavingClassEdit(false);
    }
  };

  const teacherMap: Record<string, string> = {};
  teachers.forEach((t) => {
    teacherMap[t.id] = t.name;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const filtered = classes.filter(
    (c) => {
      const q = searchTerm.toLowerCase();
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.subject || '').toLowerCase().includes(q) ||
        (c.teacherId || '').toLowerCase().includes(q) ||
        (teacherMap[c.teacherId] || '').toLowerCase().includes(q)
      );
    }
  );

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginatedClasses = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const availableToAdd = allStudents
    .filter((s) => {
      const sec = sections.find((x) => x.id === selectedSectionId);
      return !(sec?.studentIds || []).includes(s.id);
    })
    .filter(
      (s) =>
        s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
        s.id.toLowerCase().includes(studentSearch.toLowerCase()) ||
        s.phone.includes(studentSearch)
    )
    .slice(0, 10);

  // ---- Xem trước lịch dạy trong ô tạo lớp ----
  const hourTicks = buildTimelineTicks().filter((t) => t.minutes % 60 === 0);
  const previewStartMin = Math.max(timeToMinutes(newClassFormData.startTime || '00:00'), TIMELINE_START_MINUTES);
  const previewEndMin = Math.min(timeToMinutes(newClassFormData.endTime || '00:00'), TIMELINE_END_MINUTES);
  const previewValid = previewEndMin > previewStartMin;
  const previewLeftPercent = minuteToPercent(previewStartMin);
  const previewWidthPercent = previewValid ? minuteToPercent(previewEndMin) - previewLeftPercent : 0;
  const previewDurationHours = previewValid
    ? ((previewEndMin - previewStartMin) / 60).toFixed(1).replace(/\.0$/, '')
    : '0';
  const previewSessionsPerMonth = newClassFormData.scheduleDays.length * 4;

  /** Bật/tắt một thứ trong lịch học, luôn giữ tối thiểu một thứ. */
  const toggleScheduleDay = (day: number) => {
    const selected = newClassFormData.scheduleDays.includes(day);
    let updated = [...newClassFormData.scheduleDays];
    if (selected) {
      if (updated.length <= 1) return;
      updated = updated.filter((d) => d !== day);
    } else {
      updated.push(day);
      updated.sort((a, b) => a - b);
    }
    setNewClassFormData({ ...newClassFormData, scheduleDays: updated });
  };

  /**
   * Áp một khung giờ gợi ý vào lớp: ghi cả khung giờ lẫn shiftId, để lớp luôn nhất quán
   * (trước đây chỉ ghi giờ, khiến lớp mang ca mặc định lệch hẳn với giờ đang dạy).
   */
  const applyShiftPreset = (shift: TimeShift) => {
    setNewClassFormData({
      ...newClassFormData,
      shiftId: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
    });
  };

  /**
   * Đổi khung giờ thủ công. Nếu khung giờ trùng một khung giờ gợi ý thì cập nhật luôn
   * shiftId để lớp không còn mang ca lệch với giờ đang dạy; giờ lẻ thì giữ
   * nguyên ca hiện tại và chỉ dùng khung giờ làm nguồn chính khi hiển thị.
   */
  const setCustomTime = (patch: { startTime?: string; endTime?: string }) => {
    const startTime = patch.startTime ?? newClassFormData.startTime;
    const endTime = patch.endTime ?? newClassFormData.endTime;
    const matched = shifts.find((s) => s.startTime === startTime && s.endTime === endTime);
    setNewClassFormData({
      ...newClassFormData,
      startTime,
      endTime,
      shiftId: matched ? matched.id : newClassFormData.shiftId,
    });
  };

  /** Thêm một hàng ca học bổ sung trong form khởi tạo lớp. */
  const addDraftSection = () => {
    setDraftSections((prev) => [
      ...prev,
      createEmptySection(newClassFormData.teacherId || teachers[0]?.id || ''),
    ]);
  };

  const removeDraftSection = (index: number) => {
    setDraftSections((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDraftSection = (index: number, patch: Partial<DraftSection>) => {
    setDraftSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const applyDraftShiftPreset = (index: number, shift: TimeShift) => {
    updateDraftSection(index, { shiftId: shift.id, startTime: shift.startTime, endTime: shift.endTime });
  };

  const toggleDraftDay = (index: number, day: number) => {
    const sec = draftSections[index];
    if (!sec) return;
    const selected = sec.scheduleDays.includes(day);
    let updated = [...sec.scheduleDays];
    if (selected) {
      if (updated.length <= 1) return;
      updated = updated.filter((d) => d !== day);
    } else {
      updated.push(day);
      updated.sort((a, b) => a - b);
    }
    updateDraftSection(index, { scheduleDays: updated });
  };

  /** Mở bảng chỉnh danh sách ca học của trung tâm. */
  const openShiftManager = () => {
    setShiftDraft(shifts.map((s) => ({ ...s })));
    setShowShiftManager(true);
  };

  const updateShiftDraft = (index: number, patch: Partial<TimeShift>) => {
    setShiftDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addShiftDraft = () => {
    const nextId = shiftDraft.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    setShiftDraft((prev) => [
      ...prev,
      { id: nextId, name: 'Ca ' + nextId, startTime: '08:00', endTime: '10:00', isActive: true },
    ]);
  };

  const removeShiftDraft = (index: number) => {
    setShiftDraft((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const saveShifts = async () => {
    const invalid = shiftDraft.find((s) => timeToMinutes(s.endTime) <= timeToMinutes(s.startTime));
    if (invalid) {
      toast.error('Ca "' + invalid.name + '" cần có giờ kết thúc sau giờ bắt đầu.');
      return;
    }
    setSavingShifts(true);
    try {
      // Xoá những ca đã bị bỏ khỏi danh sách
      const removed = shifts.filter((s) => !shiftDraft.some((d) => d.id === s.id));
      for (const r of removed) {
        await fetch('/api/shifts?id=' + r.id, { method: 'DELETE' });
      }

      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkShifts: shiftDraft, syncFutureSlots: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const saved: TimeShift[] = data.shifts || shiftDraft;
        setShifts(saved);
        setShiftDraft(saved.map((s) => ({ ...s })));
        toast.success(data.message || 'Đã lưu danh sách ca học');
        setShowShiftManager(false);
      } else {
        toast.error(data.error || 'Lưu danh sách ca học thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    } finally {
      setSavingShifts(false);
    }
  };

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Quản lý lớp học & lịch đào tạo"
          subtitle="Quản lý thời khóa biểu, lịch học và phân công giảng viên"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Thanh tìm kiếm và nút khởi tạo */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <SearchInput
              placeholder="Tìm theo tên lớp, môn học, giảng viên, phòng..."
              value={searchTerm}
              onChange={setSearchTerm}
              className="w-full sm:w-96"
            />

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="text-xs text-muted-foreground font-medium hidden md:block">
                Tổng số: <span className="font-bold font-mono text-foreground">{classes.length}</span> lớp học
              </div>
              <Button
                variant="primary"
                icon={<Plus size={15} />}
                onClick={() => {
                  setNewClassFormData((prev) => ({
                    ...prev,
                    teacherId: prev.teacherId || teachers[0]?.id || '',
                  }));
                  setShowAddClassModal(true);
                }}
              >
                Khởi tạo lớp mới
              </Button>
            </div>
          </div>

          {/* Lưới danh sách lớp học */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-64 rounded-card bg-card border border-line p-5 space-y-3">
                  <div className="h-5 w-24 bg-muted rounded-pill animate-pulse" />
                  <div className="h-6 w-3/4 bg-muted rounded-field animate-pulse" />
                  <div className="h-16 bg-muted rounded-field animate-pulse" />
                  <div className="h-10 bg-muted rounded-field animate-pulse" />
                </div>
              ))}
            </div>
          ) : paginatedClasses.length === 0 ? (
            <Card padded>
              <EmptyState
                icon={<BookOpen size={32} />}
                title="Không tìm thấy lớp học"
                description="Thử thay đổi từ khóa tìm kiếm hoặc khởi tạo lớp học mới."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedClasses.map((cls) => {
                // Giờ riêng của lớp là nguồn chính; khung giờ gợi ý chỉ dùng khi lớp chưa đặt giờ.
                const { startTime: classStartTime, endTime: classEndTime } = getClassTimeRange(cls, shifts);
                const isRecurringClass = cls.isRecurring !== false;

                return (
                  <Card
                    key={cls.id}
                    padded
                    className="flex flex-col justify-between transition-all duration-150 group"
                  >
                    <div className="space-y-3">
                      {/* Tiêu đề & huy hiệu */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-field bg-muted text-foreground border border-line">
                              {cls.id}
                            </span>
                            {isRecurringClass && (
                              <Badge tone="info" className="text-[11px]">
                                <RotateCw size={10} className="mr-1" />
                                Định kỳ
                              </Badge>
                            )}
                          </div>
                          <h3
                            onClick={() => openClassStudentsModal(cls)}
                            className="font-bold text-foreground text-base line-clamp-1 cursor-pointer hover:text-primary transition-colors"
                            title="Bấm để xem danh sách học viên"
                          >
                            {cls.name}
                          </h3>
                          <p className="text-[12px] text-muted-foreground truncate">
                            {cls.subject || 'Đồ án kiến trúc / Mỹ thuật'}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Badge tone="success">{cls.status || 'Đang mở'}</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-danger hover:bg-danger-soft"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClassToDelete(cls);
                            }}
                            aria-label="Xóa lớp học"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>

                      {/* Khung giờ & thứ học */}
                      <div className="bg-muted p-2.5 rounded-field border border-line flex items-center justify-between text-xs">
                        <span className="font-bold font-mono text-foreground flex items-center gap-1.5">
                          <Clock size={13} className="text-muted-foreground" />
                          {classStartTime} – {classEndTime}
                        </span>
                        <span className="font-medium text-foreground bg-card px-2 py-0.5 rounded-pill border border-line">
                          {formatScheduleDays(cls.scheduleDays)}
                        </span>
                      </div>

                      {/* Chi tiết phụ: Giảng viên, Sĩ số, Discord */}
                      <div className="space-y-1.5 text-xs text-muted-foreground border-t border-line pt-2.5">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <UserCheck size={13} /> Giảng viên:
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-foreground truncate max-w-[120px]">
                              {teacherMap[cls.teacherId] || cls.teacherId}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setChangingTeacherClass(cls);
                                setNewTeacherId(cls.teacherId);
                              }}
                              className="text-subtle-foreground hover:text-foreground cursor-pointer p-0.5"
                              title="Đổi giáo viên phụ trách"
                            >
                              <Edit3 size={11} />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Users size={13} /> Sĩ số:
                          </span>
                          <span className="font-mono font-semibold text-foreground">
                            {(cls.studentIds || []).length} học viên
                          </span>
                        </div>

                        <div className="flex items-center justify-between border-t border-line/60 pt-1.5">
                          <span className="flex items-center gap-1.5">
                            <Video size={13} className="text-primary" /> Phòng trực tuyến:
                          </span>
                          <div className="flex items-center gap-1">
                            {cls.meetingLink ? (
                              <a
                                href={cls.meetingLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline max-w-[120px] truncate"
                                title={cls.meetingLink}
                              >
                                <span>Vào phòng</span>
                                <ExternalLink size={10} className="shrink-0" />
                              </a>
                            ) : (
                              <span className="text-subtle-foreground text-[11px] italic">Chưa gắn link</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMeetClass(cls);
                                setMeetLinkInput(cls.meetingLink || 'https://discord.gg/' + cls.id.toLowerCase());
                              }}
                              className="text-subtle-foreground hover:text-foreground cursor-pointer p-0.5"
                              title="Chỉnh sửa liên kết phòng học"
                            >
                              <Edit3 size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Nút hành động ở chân thẻ */}
                    <div className="pt-3 border-t border-line mt-3 space-y-2">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Users size={13} />}
                        fullWidth
                        onClick={() => openClassStudentsModal(cls)}
                      >
                        Quản lý ({(cls.studentIds || []).length})
                      </Button>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Calendar size={13} />}
                          onClick={() => {
                            setQuickScheduleClass(cls);
                            const now = new Date();
                            setQuickScheduleStartDate(now.toISOString().split('T')[0]);
                            const later = new Date(now);
                            later.setMonth(later.getMonth() + 3);
                            setQuickScheduleEndDate(later.toISOString().split('T')[0]);
                            const clsTime = getClassTimeRange(cls, shifts);
                            setQuickScheduleStartTime(clsTime.startTime || '18:30');
                            setQuickScheduleEndTime(clsTime.endTime || '20:30');
                            setQuickScheduleDays(
                              cls.scheduleDays && cls.scheduleDays.length > 0 ? cls.scheduleDays : [2, 4, 6]
                            );
                            setQuickScheduleOverwrite(false);
                          }}
                          title="Lên lịch học cho lớp"
                        >
                          Lịch
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Edit3 size={13} />}
                          onClick={() => {
                            setChangingTeacherClass(cls);
                            setNewTeacherId(cls.teacherId);
                          }}
                          title="Đổi giáo viên phụ trách"
                        >
                          Đổi GV
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Settings2 size={13} />}
                          onClick={() => openClassEditModal(cls)}
                          title="Sửa thông tin / thời gian lớp học"
                        >
                          Sửa
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Phân trang */}
          {filtered.length > pageSize && (
            <Card padded>
              <Pager
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
              />
            </Card>
          )}
        </main>

        {/* Sheet Thêm Lớp Học Mới */}
        <Sheet
          isOpen={showAddClassModal}
          onClose={() => setShowAddClassModal(false)}
          title="Thêm lớp học mới"
          description="Khởi tạo lớp học với khung giờ và thứ học linh hoạt"
          size="lg"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setShowAddClassModal(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={addClassLoading}
                onClick={handleCreateClass}
              >
                Lưu lớp học
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateClass} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tên lớp học" required>
                <Input
                  required
                  placeholder="Ví dụ: Vẽ hình họa & Tượng thạch cao"
                  value={newClassFormData.name}
                  onChange={(e) => setNewClassFormData({ ...newClassFormData, name: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bộ môn / Chuyên môn" required>
                <Input
                  required
                  placeholder="Hình họa, Bố cục màu, Mỹ thuật..."
                  value={newClassFormData.subject}
                  onChange={(e) => setNewClassFormData({ ...newClassFormData, subject: e.target.value })}
                />
              </Field>

              <Field label="Giảng viên phụ trách" required>
                <Select
                  required
                  value={newClassFormData.teacherId}
                  onChange={(e) => setNewClassFormData({ ...newClassFormData, teacherId: e.target.value })}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} - {t.name} ({t.specialty})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Lịch học: chọn khung giờ gợi ý, giờ, thứ trong tuần và xem trước */}
            <div className="rounded-card border border-line bg-muted/50 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-foreground text-[13px] flex items-center gap-1.5">
                  <Calendar size={15} className="text-primary" /> Lịch học của lớp
                </span>
                <Badge tone="primary">
                  {previewDurationHours} giờ/ca • {previewSessionsPerMonth} ca/tháng
                </Badge>
              </div>

              {/* Khung giờ gợi ý */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-muted-foreground">Chọn khung giờ gợi ý</span>
                  <button
                    type="button"
                    onClick={openShiftManager}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary-hover cursor-pointer"
                  >
                    <Settings2 size={13} /> Sửa khung giờ
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shifts.map((shift) => {
                    // Ưu tiên shiftId để nhận đúng ca đã chọn; lớp cũ chỉ có giờ thì so theo giờ.
                    const isActive =
                      Number(newClassFormData.shiftId) === shift.id ||
                      (newClassFormData.startTime === shift.startTime &&
                        newClassFormData.endTime === shift.endTime);
                    return (
                      <button
                        type="button"
                        key={shift.id}
                        onClick={() => applyShiftPreset(shift)}
                        className={
                          'h-10 px-3.5 rounded-pill text-[12px] font-semibold border transition cursor-pointer tabular ' +
                          (isActive
                            ? 'bg-primary text-white border-primary shadow-primary'
                            : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                        }
                      >
                        {shift.startTime} – {shift.endTime}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Khung giờ chi tiết */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Giờ bắt đầu" required>
                  <Input
                    type="time"
                    required
                    value={newClassFormData.startTime}
                    onChange={(e) => setCustomTime({ startTime: e.target.value })}
                    className="font-mono font-bold"
                  />
                </Field>
                <Field label="Giờ kết thúc" required>
                  <Input
                    type="time"
                    required
                    value={newClassFormData.endTime}
                    onChange={(e) => setCustomTime({ endTime: e.target.value })}
                    className="font-mono font-bold"
                  />
                </Field>
              </div>

              {/* Thứ trong tuần */}
              <div className="space-y-1.5">
                <span className="text-[12px] font-medium text-muted-foreground">Học vào các thứ</span>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {WEEK_DAY_OPTIONS.map((day) => {
                    const isSelected = newClassFormData.scheduleDays.includes(day.value);
                    return (
                      <button
                        type="button"
                        key={day.value}
                        onClick={() => toggleScheduleDay(day.value)}
                        title={day.label}
                        className={
                          'h-11 rounded-field text-[13px] font-semibold border transition cursor-pointer ' +
                          (isSelected
                            ? 'bg-primary text-white border-primary shadow-primary'
                            : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                        }
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Xem trước: dải tuần + trục giờ */}
              <div className="rounded-field bg-card border border-line p-3 space-y-3">
                <div className="flex gap-1.5">
                  {WEEK_DAY_OPTIONS.map((day) => {
                    const isSelected = newClassFormData.scheduleDays.includes(day.value);
                    return (
                      <div
                        key={day.value}
                        className={
                          'flex-1 rounded-field border px-1 py-2 text-center transition ' +
                          (isSelected ? 'bg-primary-soft border-primary/40' : 'bg-muted/60 border-line')
                        }
                      >
                        <div
                          className={
                            'text-[11px] font-bold ' +
                            (isSelected ? 'text-primary-ink' : 'text-subtle-foreground')
                          }
                        >
                          {day.short}
                        </div>
                        <div
                          className={
                            'text-[10px] font-mono mt-0.5 tabular ' +
                            (isSelected ? 'text-primary-ink' : 'text-subtle-foreground')
                          }
                        >
                          {isSelected ? formatTimeHM(newClassFormData.startTime) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1">
                  <div className="relative h-8 rounded-field bg-muted overflow-hidden border border-line">
                    {previewValid && (
                      <div
                        className="absolute top-1 bottom-1 rounded-field bg-primary-soft border border-primary/40 flex items-center justify-center overflow-hidden"
                        style={{ left: previewLeftPercent + '%', width: previewWidthPercent + '%' }}
                      >
                        <span className="text-[10px] font-mono font-bold text-primary-ink whitespace-nowrap tabular">
                          {formatTimeHM(newClassFormData.startTime)} – {formatTimeHM(newClassFormData.endTime)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="relative h-4">
                    {hourTicks.map((t) => (
                      <span
                        key={t.minutes}
                        className="absolute text-[10px] font-mono text-subtle-foreground -translate-x-1/2 tabular"
                        style={{ left: minuteToPercent(t.minutes) + '%' }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                {!previewValid && (
                  <p className="text-[12px] text-warning font-medium">
                    Giờ kết thúc phải sau giờ bắt đầu.
                  </p>
                )}
              </div>
            </div>

            {/* Nhiều ca học trong cùng một lớp */}
            <div className="rounded-card border border-line bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-foreground text-[13px] flex items-center gap-1.5">
                    <Users size={15} className="text-primary" /> Các ca học của lớp ({draftSections.length + 1} ca)
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Mỗi ca có thể có giờ, thứ và giáo viên riêng. Học viên chỉ tham gia ca đã chọn.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={13} />}
                  onClick={addDraftSection}
                >
                  Thêm ca
                </Button>
              </div>

              {/* Ca gốc (từ khung giờ chính phía trên) */}
              <div className="rounded-field bg-card border border-line p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-foreground">Ca 1 (khung giờ chính)</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {newClassFormData.startTime} – {newClassFormData.endTime} ·{' '}
                    {formatScheduleDays(newClassFormData.scheduleDays)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Giảng viên: {teacherMap[newClassFormData.teacherId] || newClassFormData.teacherId || '—'}
                </div>
              </div>

              {draftSections.map((sec, index) => (
                <div
                  key={index}
                  className="rounded-field bg-card border border-line p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold text-foreground">Ca {index + 2}</span>
                    <button
                      type="button"
                      onClick={() => removeDraftSection(index)}
                      className="text-subtle-foreground hover:text-danger cursor-pointer p-0.5"
                      title="Bỏ ca này"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {shifts.map((shift) => {
                      const isActive =
                        Number(sec.shiftId) === shift.id ||
                        (sec.startTime === shift.startTime && sec.endTime === shift.endTime);
                      return (
                        <button
                          type="button"
                          key={shift.id}
                          onClick={() => applyDraftShiftPreset(index, shift)}
                          className={
                            'h-8 px-3 rounded-pill text-[11px] font-semibold border transition cursor-pointer tabular ' +
                            (isActive
                              ? 'bg-primary text-white border-primary shadow-primary'
                              : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                          }
                        >
                          {shift.startTime} – {shift.endTime}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Field label="Giờ bắt đầu">
                      <Input
                        type="time"
                        value={sec.startTime}
                        onChange={(e) => updateDraftSection(index, { startTime: e.target.value })}
                        className="font-mono font-bold"
                      />
                    </Field>
                    <Field label="Giờ kết thúc">
                      <Input
                        type="time"
                        value={sec.endTime}
                        onChange={(e) => updateDraftSection(index, { endTime: e.target.value })}
                        className="font-mono font-bold"
                      />
                    </Field>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Học vào các thứ</span>
                    <div className="grid grid-cols-7 gap-1.5">
                      {WEEK_DAY_OPTIONS.map((day) => {
                        const isSelected = sec.scheduleDays.includes(day.value);
                        return (
                          <button
                            type="button"
                            key={day.value}
                            onClick={() => toggleDraftDay(index, day.value)}
                            title={day.label}
                            className={
                              'h-9 rounded-field text-[12px] font-semibold border transition cursor-pointer ' +
                              (isSelected
                                ? 'bg-primary text-white border-primary shadow-primary'
                                : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                            }
                          >
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Field label="Giảng viên">
                      <Select
                        value={sec.teacherId}
                        onChange={(e) => updateDraftSection(index, { teacherId: e.target.value })}
                      >
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.id} - {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            <Field label="Liên kết phòng học trực tuyến (Discord / Meet)">
              <Input
                type="url"
                placeholder="https://discord.gg/..."
                value={newClassFormData.meetingLink}
                onChange={(e) => setNewClassFormData({ ...newClassFormData, meetingLink: e.target.value })}
                className="font-mono"
              />
            </Field>

            {/* Tùy chọn lặp định kỳ */}
            <div className="p-3.5 bg-muted rounded-card border border-line space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newClassFormData.isRecurring}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNewClassFormData({
                      ...newClassFormData,
                      isRecurring: val,
                      autoGenerateSchedule: val ? true : newClassFormData.autoGenerateSchedule,
                    });
                  }}
                  className="w-4 h-4 text-primary rounded border-line focus:ring-primary"
                />
                <span className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                  <RotateCw size={13} /> Chạy định kỳ qua các tuần tiếp theo
                </span>
              </label>

              {newClassFormData.isRecurring && (
                <div className="pl-6 space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-muted-foreground">Khoảng thời gian sinh lịch:</label>
                    <Select
                      value={newClassFormData.generateMonths}
                      onChange={(e) =>
                        setNewClassFormData({
                          ...newClassFormData,
                          generateMonths: Number(e.target.value),
                        })
                      }
                      className="h-9 w-40 text-xs"
                    >
                      <option value={1}>1 tháng tới</option>
                      <option value={2}>2 tháng tới</option>
                      <option value={3}>3 tháng tới</option>
                    </Select>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    Hệ thống sẽ tự động tạo ca học định kỳ vào đúng khung giờ và thứ đã chọn.
                  </p>
                </div>
              )}
            </div>
          </form>
        </Sheet>

        {/* Sheet Sửa Link Phòng Học Trực Tuyến */}
        <Sheet
          isOpen={!!editingMeetClass}
          onClose={() => setEditingMeetClass(null)}
          title="Liên kết phòng học trực tuyến"
          description={
            editingMeetClass
              ? 'Lớp: ' + editingMeetClass.name + ' (' + editingMeetClass.id + ')'
              : undefined
          }
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setEditingMeetClass(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={savingMeetLink}
                onClick={handleSaveMeetLink}
              >
                Cập nhật liên kết
              </Button>
            </div>
          }
        >
          <form onSubmit={handleSaveMeetLink} className="space-y-4">
            <Field label="Đường dẫn phòng học (Discord / Google Meet)" required>
              <Input
                type="url"
                required
                placeholder="https://discord.gg/..."
                value={meetLinkInput}
                onChange={(e) => setMeetLinkInput(e.target.value)}
                className="font-mono text-xs"
              />
            </Field>

            <div className="p-3 bg-muted border border-line rounded-card text-xs text-muted-foreground leading-relaxed">
              Liên kết phòng học sẽ tự động hiển thị trên thời khóa biểu và giao diện vào lớp của học viên và giảng viên.
            </div>
          </form>
        </Sheet>

        {/* Sheet Đổi Giáo Viên Quản Lý Lớp */}
        <Sheet
          isOpen={!!changingTeacherClass}
          onClose={() => setChangingTeacherClass(null)}
          title="Đổi giáo viên quản lý lớp"
          description={
            changingTeacherClass
              ? 'Lớp: ' + changingTeacherClass.name + ' (' + changingTeacherClass.id + ')'
              : undefined
          }
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setChangingTeacherClass(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={changingTeacherLoading}
                onClick={handleChangeTeacher}
              >
                Lưu thay đổi
              </Button>
            </div>
          }
        >
          <form onSubmit={handleChangeTeacher} className="space-y-4">
            <div className="bg-muted p-3 rounded-card border border-line text-xs space-y-1">
              <div className="text-muted-foreground">Giáo viên hiện tại:</div>
              <div className="font-bold text-foreground">
                {changingTeacherClass
                  ? teacherMap[changingTeacherClass.teacherId] || changingTeacherClass.teacherId
                  : ''}
              </div>
            </div>

            <Field label="Chọn giáo viên thay thế" required>
              <Select
                value={newTeacherId}
                onChange={(e) => setNewTeacherId(e.target.value)}
              >
                {teachers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.id} - {tc.name} ({tc.specialty})
                  </option>
                ))}
              </Select>
            </Field>

            <p className="text-xs text-muted-foreground">
              Hệ thống sẽ cập nhật phân công lớp và lịch giảng dạy cho giáo viên mới.
            </p>
          </form>
        </Sheet>

        {/* Sheet Quản Lý Học Viên Trong Lớp */}
        <Sheet
          isOpen={!!selectedClass}
          onClose={() => setSelectedClass(null)}
          title="Quản lý học viên"
          description={
            selectedClass
              ? selectedClass.name + ' (' + selectedClass.id + ') • Sĩ số: ' + (selectedClass.studentIds || []).length
              : undefined
          }
          size="lg"
          footer={
            <div className="flex items-center justify-end w-full">
              <Button variant="secondary" onClick={() => setSelectedClass(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          <div className="space-y-5">
            {/* Chọn ca học của lớp + quản lý ca (thêm/sửa/xoá, đổi GV từng ca) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Ca học của lớp
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={13} />}
                  onClick={() => openSectionForm(null)}
                >
                  Thêm ca
                </Button>
              </div>

              {sections.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground border border-dashed border-line rounded-card">
                  Lớp chưa có ca học nào. Bấm &quot;Thêm ca&quot; để tạo ca đầu tiên.
                </div>
              ) : (
                <div className="space-y-2">
                  {sections.map((sec) => {
                    const isActive = sec.id === selectedSectionId;
                    return (
                      <div
                        key={sec.id}
                        className={
                          'rounded-field border border-line p-2.5 flex items-center justify-between gap-2 transition ' +
                          (isActive ? 'bg-primary-soft border-primary/40' : 'bg-card hover:bg-muted/40')
                        }
                      >
                        <button
                          type="button"
                          onClick={() => handleSectionChange(sec.id)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="text-[12px] font-bold text-foreground truncate">
                            {sec.name || sec.id}
                            <span className="ml-1.5 text-[11px] font-semibold text-muted-foreground">
                              · {(sec.studentIds || []).length} HS
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {sec.startTime} – {sec.endTime} · {formatScheduleDays(sec.scheduleDays)} ·{' '}
                            GV: {teacherMap[sec.teacherId || ''] || sec.teacherId || '—'}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openSectionForm(sec)}
                            className="text-subtle-foreground hover:text-foreground cursor-pointer p-1"
                            title="Sửa ca / đổi giáo viên"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSection(sec)}
                            className="text-subtle-foreground hover:text-danger cursor-pointer p-1"
                            title="Xóa ca"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Danh sách học viên đang học */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Học viên đang học (
                  {(() => {
                    const activeSec = sections.find((x) => x.id === selectedSectionId);
                    return enrolledStudents.filter((st) => {
                      if (filterDay === null) return true;
                      return studentDaysInSection(activeSec, st.id).includes(filterDay);
                    }).length;
                  })()}
                  )
                </span>
              </div>

              {/* Bộ lọc theo thứ (chỉ lọc trong ca đang chọn) */}
              {sections.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    type="button"
                    onClick={() => setFilterDay(null)}
                    className={
                      'px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition ' +
                      (filterDay === null
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card text-muted-foreground border-line hover:bg-muted')
                    }
                  >
                    Tất cả
                  </button>
                  {WEEK_DAY_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setFilterDay(filterDay === d.value ? null : d.value)}
                      className={
                        'px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition ' +
                        (filterDay === d.value
                          ? 'bg-primary text-white border-primary'
                          : 'bg-card text-muted-foreground border-line hover:bg-muted')
                      }
                    >
                      {d.short}
                    </button>
                  ))}
                </div>
              )}

              <div className="border border-line rounded-card overflow-hidden divide-y divide-line max-h-52 overflow-y-auto">
                {modalLoading ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">Đang tải danh sách...</div>
                ) : enrolledStudents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Lớp hiện chưa có học viên nào.
                  </div>
                ) : (
                  (() => {
                    const activeSec = sections.find((x) => x.id === selectedSectionId);
                    const visible = enrolledStudents.filter((st) => {
                      if (filterDay === null) return true;
                      return studentDaysInSection(activeSec, st.id).includes(filterDay);
                    });
                    if (visible.length === 0) {
                      return (
                        <div className="p-6 text-center text-xs text-muted-foreground">
                          Không có học viên học vào thứ này.
                        </div>
                      );
                    }
                    return visible.map((st) => {
                      const days = studentDaysInSection(activeSec, st.id);
                      return (
                        <div
                          key={st.id}
                          className="p-3 flex items-center justify-between text-xs hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">
                              {st.id} - {st.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                              {st.phone || '—'}
                              <span className="text-line">•</span>
                              <span className="inline-flex items-center gap-1">
                                {days.length > 0
                                  ? days.map((d) => (
                                      <span
                                        key={d}
                                        className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold text-muted-foreground"
                                      >
                                        {d === 8 ? 'CN' : 'T' + d}
                                      </span>
                                    ))
                                  : 'Cả tuần'}
                              </span>
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-danger h-8 w-8 shrink-0"
                            onClick={() => handleEnrollAction(st.id, 'UNENROLL')}
                            title="Xoá học viên khỏi lớp"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      );
                    });
                  })()
                )}
              </div>
            </div>

            {/* Thêm học viên mới vào lớp */}
            <div className="space-y-3 pt-3 border-t border-line">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                Thêm học viên vào lớp
              </span>

              <SearchInput
                placeholder="Tìm mã, họ tên hoặc số điện thoại..."
                value={studentSearch}
                onChange={setStudentSearch}
              />

              <div className="border border-line rounded-card overflow-hidden divide-y divide-line max-h-48 overflow-y-auto">
                {availableToAdd.map((st) => (
                  <div
                    key={st.id}
                    className="p-3 flex items-center justify-between text-xs hover:bg-muted/40 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-foreground">
                        {st.id} - {st.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {st.phone || '—'} • Đang học {(st.enrolledClassIds || []).length} lớp
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus size={13} />}
                      onClick={() => handleEnrollAction(st.id, 'ENROLL')}
                    >
                      Thêm vào lớp
                    </Button>
                  </div>
                ))}
                {studentSearch && availableToAdd.length === 0 && (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Không tìm thấy học viên phù hợp.
                  </div>
                )}
                {!studentSearch && (
                  <div className="p-3 text-center text-[11px] text-subtle-foreground">
                    Nhập từ khóa để tìm kiếm học viên cần thêm vào lớp.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Sheet>

        {/* Sheet Thêm / Sửa Ca Học Của Lớp */}
        <Sheet
          isOpen={sectionFormOpen}
          onClose={() => setSectionFormOpen(false)}
          title={editingSection ? 'Sửa ca học' : 'Thêm ca học cho lớp'}
          description={selectedClass ? selectedClass.name + ' (' + selectedClass.id + ')' : undefined}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setSectionFormOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={sectionFormLoading}
                onClick={saveSectionForm}
              >
                {editingSection ? 'Lưu ca học' : 'Thêm ca học'}
              </Button>
            </div>
          }
        >
          <form onSubmit={saveSectionForm} className="space-y-4">
            <Field label="Tên ca (tùy chọn)">
              <Input
                placeholder="Ví dụ: Ca sáng, Ca tối..."
                value={sectionForm.name}
                onChange={(e) => setSectionForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </Field>

            <div className="space-y-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">Chọn khung giờ gợi ý</span>
              <div className="flex flex-wrap gap-2">
                {shifts.map((shift) => {
                  const isActive =
                    Number(sectionForm.shiftId) === shift.id ||
                    (sectionForm.startTime === shift.startTime && sectionForm.endTime === shift.endTime);
                  return (
                    <button
                      type="button"
                      key={shift.id}
                      onClick={() => applySectionShiftPreset(shift)}
                      className={
                        'h-10 px-3.5 rounded-pill text-[12px] font-semibold border transition cursor-pointer tabular ' +
                        (isActive
                          ? 'bg-primary text-white border-primary shadow-primary'
                          : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                      }
                    >
                      {shift.startTime} – {shift.endTime}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Giờ bắt đầu" required>
                <Input
                  type="time"
                  required
                  value={sectionForm.startTime}
                  onChange={(e) => setSectionForm((prev) => ({ ...prev, startTime: e.target.value }))}
                  className="font-mono font-bold"
                />
              </Field>
              <Field label="Giờ kết thúc" required>
                <Input
                  type="time"
                  required
                  value={sectionForm.endTime}
                  onChange={(e) => setSectionForm((prev) => ({ ...prev, endTime: e.target.value }))}
                  className="font-mono font-bold"
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">Học vào các thứ</span>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEK_DAY_OPTIONS.map((day) => {
                  const isSelected = sectionForm.scheduleDays.includes(day.value);
                  return (
                    <button
                      type="button"
                      key={day.value}
                      onClick={() => toggleSectionDay(day.value)}
                      title={day.label}
                      className={
                        'h-9 rounded-field text-[12px] font-semibold border transition cursor-pointer ' +
                        (isSelected
                          ? 'bg-primary text-white border-primary shadow-primary'
                          : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                      }
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Giảng viên (theo ca)" required>
                <Select
                  required
                  value={sectionForm.teacherId}
                  onChange={(e) => setSectionForm((prev) => ({ ...prev, teacherId: e.target.value }))}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} - {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <p className="text-xs text-muted-foreground">
              Đổi giáo viên hoặc thời gian của ca sẽ tự đồng bộ cho các buổi học tương lai thuộc ca này.
            </p>
          </form>
        </Sheet>

        {/* Sheet Sửa Thông Tin / Thời Gian Lớp Học */}
        <Sheet
          isOpen={!!editingClass}
          onClose={() => setEditingClass(null)}
          title="Sửa thông tin lớp học"
          description={
            editingClass
              ? 'Lớp: ' + editingClass.name + ' (' + editingClass.id + ')'
              : undefined
          }
          size="lg"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setEditingClass(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={savingClassEdit}
                onClick={handleSaveClassEdit}
              >
                Lưu thay đổi
              </Button>
            </div>
          }
        >
          <form onSubmit={handleSaveClassEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tên lớp học" required>
                <Input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </Field>
              <Field label="Bộ môn / Chuyên môn" required>
                <Input
                  required
                  value={editForm.subject}
                  onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Giảng viên phụ trách" required>
                <Select
                  required
                  value={editForm.teacherId}
                  onChange={(e) => setEditForm({ ...editForm, teacherId: e.target.value })}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} - {t.name} ({t.specialty})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Giờ bắt đầu" required>
                <Input
                  type="time"
                  required
                  value={editForm.startTime}
                  onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                  className="font-mono font-bold"
                />
              </Field>
              <Field label="Giờ kết thúc" required>
                <Input
                  type="time"
                  required
                  value={editForm.endTime}
                  onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                  className="font-mono font-bold"
                />
              </Field>
              <Field label="Học phí (VND)">
                <Input
                  type="number"
                  value={editForm.tuitionFee}
                  onChange={(e) =>
                    setEditForm({ ...editForm, tuitionFee: Number(e.target.value) || 0 })
                  }
                  className="font-mono font-bold"
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">Học vào các thứ</span>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {WEEK_DAY_OPTIONS.map((day) => {
                  const isSelected = editForm.scheduleDays.includes(day.value);
                  return (
                    <button
                      type="button"
                      key={day.value}
                      onClick={() => {
                        const selected = editForm.scheduleDays.includes(day.value);
                        let updated = [...editForm.scheduleDays];
                        if (selected) {
                          if (updated.length <= 1) return;
                          updated = updated.filter((d) => d !== day.value);
                        } else {
                          updated.push(day.value);
                          updated.sort((a, b) => a - b);
                        }
                        setEditForm({ ...editForm, scheduleDays: updated });
                      }}
                      title={day.label}
                      className={
                        'h-11 rounded-field text-[13px] font-semibold border transition cursor-pointer ' +
                        (isSelected
                          ? 'bg-primary text-white border-primary shadow-primary'
                          : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                      }
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Liên kết phòng học trực tuyến (Discord / Meet)">
              <Input
                type="url"
                value={editForm.meetingLink}
                onChange={(e) => setEditForm({ ...editForm, meetingLink: e.target.value })}
                className="font-mono"
              />
            </Field>

            <p className="text-xs text-muted-foreground">
              Hệ thống sẽ cập nhật thông tin lớp và đồng bộ khung giờ cho các ca học trong tương lai.
            </p>
          </form>
        </Sheet>

        {/* Sheet Lên Lịch Nhanh Cho Lớp */}
        <Sheet
          isOpen={!!quickScheduleClass}
          onClose={() => setQuickScheduleClass(null)}
          title="Lên lịch học cho lớp"
          description={
            quickScheduleClass
              ? quickScheduleClass.name + ' (' + quickScheduleClass.id + ')'
              : undefined
          }
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setQuickScheduleClass(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={quickScheduleSubmitting}
                icon={<Sparkles size={14} />}
                onClick={handleQuickSchedule}
              >
                Sinh lịch ngay
              </Button>
            </div>
          }
        >
          <form onSubmit={handleQuickSchedule} className="space-y-4">
            <div className="bg-muted p-3 rounded-card border border-line space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Khung giờ lớp:</span>
                <span className="font-mono font-bold text-foreground">
                  {quickScheduleStartTime} - {quickScheduleEndTime}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Thứ học:</span>
                <span className="font-semibold text-foreground">
                  {formatScheduleDays(quickScheduleDays)}
                </span>
              </div>
            </div>

            {/* Xem trước: dải tuần theo thứ đã chọn */}
            <div className="flex gap-1.5">
              {WEEK_DAY_OPTIONS.map((day) => {
                const isSelected = quickScheduleDays.includes(day.value);
                return (
                  <div
                    key={day.value}
                    className={
                      'flex-1 rounded-field border px-1 py-2 text-center transition ' +
                      (isSelected ? 'bg-primary-soft border-primary/40' : 'bg-muted/60 border-line')
                    }
                  >
                    <div
                      className={
                        'text-[11px] font-bold ' +
                        (isSelected ? 'text-primary-ink' : 'text-subtle-foreground')
                      }
                    >
                      {day.short}
                    </div>
                    <div
                      className={
                        'text-[10px] font-mono mt-0.5 tabular ' +
                        (isSelected ? 'text-primary-ink' : 'text-subtle-foreground')
                      }
                    >
                      {isSelected ? quickScheduleStartTime : '—'}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {shifts.map((shift) => {
                const isActive =
                  quickScheduleStartTime === shift.startTime && quickScheduleEndTime === shift.endTime;
                return (
                  <button
                    type="button"
                    key={shift.id}
                    onClick={() => {
                      setQuickScheduleStartTime(shift.startTime);
                      setQuickScheduleEndTime(shift.endTime);
                    }}
                    className={
                      'h-10 px-3.5 rounded-pill text-[12px] font-semibold border transition cursor-pointer tabular ' +
                      (isActive
                        ? 'bg-primary text-white border-primary shadow-primary'
                        : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted')
                    }
                  >
                    {shift.startTime} – {shift.endTime}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Giờ bắt đầu" required>
                <Input
                  type="time"
                  required
                  value={quickScheduleStartTime}
                  onChange={(e) => setQuickScheduleStartTime(e.target.value)}
                  className="font-mono font-bold"
                />
              </Field>
              <Field label="Giờ kết thúc" required>
                <Input
                  type="time"
                  required
                  value={quickScheduleEndTime}
                  onChange={(e) => setQuickScheduleEndTime(e.target.value)}
                  className="font-mono font-bold"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Từ ngày" required>
                <Input
                  type="date"
                  required
                  value={quickScheduleStartDate}
                  onChange={(e) => setQuickScheduleStartDate(e.target.value)}
                />
              </Field>
              <Field label="Đến ngày" required>
                <Input
                  type="date"
                  required
                  value={quickScheduleEndDate}
                  onChange={(e) => setQuickScheduleEndDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Chọn nhanh:</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const base = quickScheduleStartDate ? new Date(quickScheduleStartDate) : new Date();
                  base.setMonth(base.getMonth() + 1);
                  setQuickScheduleEndDate(base.toISOString().split('T')[0]);
                }}
              >
                +1 tháng
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const base = quickScheduleStartDate ? new Date(quickScheduleStartDate) : new Date();
                  base.setMonth(base.getMonth() + 3);
                  setQuickScheduleEndDate(base.toISOString().split('T')[0]);
                }}
              >
                +3 tháng
              </Button>
            </div>

            <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-field bg-muted border border-line">
              <input
                type="checkbox"
                checked={quickScheduleOverwrite}
                onChange={(e) => setQuickScheduleOverwrite(e.target.checked)}
                className="w-4 h-4 text-primary rounded border-line focus:ring-primary"
              />
              <span className="text-foreground font-medium text-xs">
                Ghi đè lịch nếu ngày đó đã có ca của lớp
              </span>
            </label>
          </form>
        </Sheet>

        {/* Sheet Xác Nhận Xoá Lớp Học */}
        <Sheet
          isOpen={showShiftManager}
          onClose={() => setShowShiftManager(false)}
          title="Danh sách khung giờ gợi ý của trung tâm"
          description="Thêm, sửa hoặc bớt khung giờ. Giờ mới sẽ tự cập nhật cho các ca học sắp tới."
          size="md"
          footer={
            <div className="flex items-center justify-between gap-2 w-full">
              <Button variant="secondary" icon={<Plus size={14} />} onClick={addShiftDraft}>
                Thêm khung giờ
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setShowShiftManager(false)}>
                  Hủy
                </Button>
                <Button variant="primary" loading={savingShifts} icon={<Check size={15} />} onClick={saveShifts}>
                  Lưu khung giờ
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            {shiftDraft.map((shift, index) => (
              <div key={shift.id} className="rounded-card border border-line bg-muted/50 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-mono font-bold text-muted-foreground">Khung giờ {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeShiftDraft(index)}
                    disabled={shiftDraft.length <= 1}
                    className="text-subtle-foreground hover:text-danger cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Bỏ khung giờ này"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Field label="Tên khung giờ">
                    <Input
                      value={shift.name}
                      onChange={(e) => updateShiftDraft(index, { name: e.target.value })}
                      placeholder={'Khung giờ ' + (index + 1)}
                    />
                  </Field>
                  <Field label="Bắt đầu">
                    <Input
                      type="time"
                      value={shift.startTime}
                      onChange={(e) => updateShiftDraft(index, { startTime: e.target.value })}
                      className="font-mono font-bold"
                    />
                  </Field>
                  <Field label="Kết thúc">
                    <Input
                      type="time"
                      value={shift.endTime}
                      onChange={(e) => updateShiftDraft(index, { endTime: e.target.value })}
                      className="font-mono font-bold"
                    />
                  </Field>
                </div>
              </div>
            ))}
            <p className="text-[12px] text-muted-foreground">
              Danh sách này là các khung giờ gợi ý khi mở lớp. Mỗi lớp vẫn có thể chỉnh giờ riêng.
            </p>
          </div>
        </Sheet>

        {/* Sheet Xác Nhận Xoá Lớp Học */}
        <Sheet
          isOpen={!!classToDelete}
          onClose={() => setClassToDelete(null)}
          title="Xác nhận xoá lớp học"
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setClassToDelete(null)}>
                Hủy
              </Button>
              <Button
                variant="danger"
                loading={isDeletingClass}
                onClick={confirmDeleteClass}
              >
                Xác nhận xoá
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Bạn có chắc chắn muốn xoá lớp{' '}
              <strong className="text-foreground">{classToDelete?.name}</strong> (
              <span className="font-mono">{classToDelete?.id}</span>)?
            </p>
            {classToDelete && (classToDelete.studentIds || []).length > 0 && (
              <div className="p-3 bg-danger-soft border border-danger/20 rounded-field text-xs text-danger font-medium">
                Cảnh báo: Lớp học hiện có {(classToDelete.studentIds || []).length} học viên đang ghi danh.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Thao tác này sẽ xoá thông tin lớp học khỏi hệ thống.
            </p>
          </div>
        </Sheet>
      </div>
    </RoleGuard>
  );
}
