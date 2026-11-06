'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { Student } from '@/types/student';
import { ClassEntity } from '@/types/classroom';
import { formatClassTimeLabel } from '@/utils/schedule';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import {
  Card,
  Button,
  Badge,
  Field,
  Input,
  Select,
  Textarea,
  Sheet,
  useToast,
  SegmentedControl,
  SearchInput,
  DataTable,
  Pager,
  Column,
} from '@/components/ui';
import {
  BookOpen,
  Plus,
  Trash2,
  Zap,
  Copy,
  Check,
  Minus,
  FolderKanban,
} from 'lucide-react';

const STATUS_OPTIONS: { value: Student['status'] | 'ALL'; label: string }[] = [
  { value: 'Đang học', label: 'Đang học' },
  { value: 'Tạm dừng', label: 'Tạm dừng' },
  { value: 'Bảo lưu', label: 'Bảo lưu' },
  { value: 'Đã nghỉ học', label: 'Đã nghỉ' },
  { value: 'Đã tốt nghiệp', label: 'Tốt nghiệp' },
  { value: 'ALL', label: 'Tất cả' },
];

/** Danh sách trạng thái học viên dùng cho nút chọn nhanh và bộ lọc. */
const STUDENT_STATUSES: Student['status'][] = [
  'Đang học',
  'Tạm dừng',
  'Bảo lưu',
  'Đã nghỉ học',
  'Đã tốt nghiệp',
];

const TARGET_UNI_FILTERS = [
  { id: 'ALL', label: 'Tất cả trường & khối' },
  { id: 'HAU_V', label: 'HAU - Khối V' },
  { id: 'HAU_H', label: 'HAU - Khối H' },
  { id: 'HUCE_V', label: 'HUCE - Khối V' },
  { id: 'HUCE_H', label: 'HUCE - Khối H' },
  { id: 'MTCN_V', label: 'MTCN - Khối V' },
  { id: 'MTCN_H', label: 'MTCN - Khối H' },
  { id: 'NUAE', label: 'NUAE' },
  { id: 'HNUE', label: 'HNUE' },
  { id: 'VNUFA', label: 'VNUFA' },
  { id: 'HOU', label: 'HOU' },
  { id: 'VNU-SIS', label: 'VNU-SIS' },
  { id: 'KHAC', label: 'Trường khác' },
];

function getStatusTone(
  status: Student['status']
): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'Đang học':
      return 'success';
    case 'Tạm dừng':
      return 'warning';
    case 'Đã nghỉ học':
      return 'danger';
    case 'Bảo lưu':
      return 'info';
    case 'Đã tốt nghiệp':
      return 'primary';
    default:
      return 'neutral';
  }
}

function getSessionTone(remaining: number): 'success' | 'warning' | 'danger' {
  if (remaining >= 4) return 'success';
  if (remaining > 0) return 'warning';
  return 'danger';
}

export default function AdminStudentsPage() {
  const toast = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [statusTab, setStatusTab] = useState<Student['status'] | 'ALL'>('Đang học');
  const [targetUniFilter, setTargetUniFilter] = useState<string>('ALL');
  const [editingSessionStudent, setEditingSessionStudent] = useState<Student | null>(null);
  const [editSessionInput, setEditSessionInput] = useState<number>(12);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);

  // Modal / Sheet gán lớp cho học viên
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Sheet đổi trạng thái học viên
  const [statusStudent, setStatusStudent] = useState<Student | null>(null);

  // Modal / Sheet xoá học viên
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal / Sheet 1-Click Fast Onboarding
  const [showFastModal, setShowFastModal] = useState(false);
  const [fastLoading, setFastLoading] = useState(false);
  const [fastData, setFastData] = useState({
    name: '',
    phone: '',
  });

  // Modal / Sheet Kết quả bàn giao tài khoản vừa tạo
  const [createdStudentInfo, setCreatedStudentInfo] = useState<{
    id: string;
    name: string;
    username: string;
    defaultPassword: string;
    phone: string;
  } | null>(null);
  const [copiedHandover, setCopiedHandover] = useState(false);

  // Modal / Sheet Thêm Học Viên Đầy Đủ
  const [showAddModal, setShowAddModal] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [newStudentData, setNewStudentData] = useState({
    name: '',
    phone: '',
    gender: 'Nam' as 'Nam' | 'Nữ',
    dateOfBirth: '2008-01-01',
    address: 'TP. Hà Nội',
    selectedClassIds: [] as string[],
    parentPhone: '',
    homeTown: '',
    gradeLevel: 'Lớp 12',
    targetUniversity: 'HAU',
    customUniversity: '',
    examBlock: 'KHOI_V' as 'KHOI_V' | 'KHOI_H',
    studyGoal: 'Thi Đại Học',
    facebookUrl: '',
    otherNotes: '',
    totalSessionsInMonth: 12,
    remainingSessions: 12,
  });

  const loadStudents = async (
    p = 1,
    limit = 20,
    search = '',
    status = statusTab,
    uni = targetUniFilter
  ) => {
    setLoading(true);
    try {
      const [stRes, clsRes] = await Promise.all([
        fetch(
          `/api/students?page=${p}&limit=${limit}&search=${encodeURIComponent(search)}` +
            `&status=${encodeURIComponent(status)}&uni=${encodeURIComponent(uni)}`
        ),
        fetch('/api/classes'),
      ]);
      const stData = await stRes.json();
      const clsData = await clsRes.json();
      setStudents(stData.students || []);
      setTotalPages(stData.totalPages || 1);
      setTotal(stData.total || 0);
      setClasses(clsData.classes || []);
    } catch (e: any) {
      toast.error(e?.message || 'Không thể tải danh sách học viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudents(page, pageSize, searchTerm, statusTab, targetUniFilter);
     
  }, [page, pageSize, searchTerm, statusTab, targetUniFilter]);

  const handleRowStatusChange = async (student: Student, newStatus: Student['status']) => {
    if (!student || !newStatus || newStatus === student.status) return;
    try {
      const res = await fetch(`/api/students/${student.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (res.ok) {
        setStudents((prev) =>
          prev.map((s) => (s.id === student.id ? { ...s, status: newStatus } : s))
        );
        toast.success(`Đã chuyển học viên ${student.name} sang "${newStatus}"`);
      } else {
        toast.error(data.error || 'Cập nhật trạng thái thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng khi cập nhật trạng thái');
    }
  };

  const handleQuickAdjustSessions = async (st: Student, delta: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const current = st.remainingSessions ?? st.totalSessionsInMonth ?? 12;
    const nextVal = Math.max(0, current + delta);
    try {
      const res = await fetch(`/api/students/${st.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remainingSessions: nextVal }),
      });
      const data = await res.json();
      if (res.ok) {
        setStudents((prev) =>
          prev.map((s) => (s.id === st.id ? { ...s, remainingSessions: nextVal } : s))
        );
        toast.success(`Đã điều chỉnh số buổi của ${st.name} thành ${nextVal}`);
      } else {
        toast.error(data.error || 'Thao tác thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    }
  };

  const handleUpdateRemainingSessions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSessionStudent) return;
    try {
      const res = await fetch(`/api/students/${editingSessionStudent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remainingSessions: editSessionInput }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Đã cập nhật số buổi của ${editingSessionStudent.name} thành ${editSessionInput}`);
        setEditingSessionStudent(null);
        await loadStudents(page, pageSize, searchTerm);
      } else {
        toast.error(data.error || 'Cập nhật thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    }
  };

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const handleFastOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fastData.name.trim()) {
      toast.error('Vui lòng nhập họ và tên học viên');
      return;
    }
    setFastLoading(true);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fastData.name.trim(),
          phone: fastData.phone.trim(),
          fastOnboarding: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowFastModal(false);
        setCreatedStudentInfo({
          id: data.student.id,
          name: data.student.name,
          username: data.student.id.toLowerCase(),
          defaultPassword: data.defaultPassword || '123456',
          phone: data.student.phone || '',
        });
        setFastData({ name: '', phone: '' });
        toast.success('Tiếp nhận học viên thành công');
        await loadStudents(page, pageSize, searchTerm);
      } else {
        toast.error(data.error || 'Tạo nhanh học viên thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi kết nối máy chủ');
    } finally {
      setFastLoading(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentData.name.trim()) {
      toast.error('Vui lòng nhập họ và tên học viên');
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newStudentData.name,
          phone: newStudentData.phone,
          gender: newStudentData.gender,
          dateOfBirth: newStudentData.dateOfBirth,
          address: newStudentData.address,
          enrolledClassIds: newStudentData.selectedClassIds,
          parentPhone: newStudentData.parentPhone,
          homeTown: newStudentData.homeTown,
          gradeLevel: newStudentData.gradeLevel,
          targetUniversity: newStudentData.targetUniversity,
          customUniversity: newStudentData.customUniversity,
          examBlock: newStudentData.examBlock,
          studyGoal: newStudentData.studyGoal,
          facebookUrl: newStudentData.facebookUrl,
          otherNotes: newStudentData.otherNotes,
          totalSessionsInMonth: newStudentData.totalSessionsInMonth,
          remainingSessions: newStudentData.remainingSessions,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddModal(false);
        setCreatedStudentInfo({
          id: data.student.id,
          name: data.student.name,
          username: data.student.id.toLowerCase(),
          defaultPassword: data.defaultPassword || '123456',
          phone: data.student.phone || '',
        });
        setNewStudentData({
          name: '',
          phone: '',
          gender: 'Nam',
          dateOfBirth: '2008-01-01',
          address: 'TP. Hà Nội',
          selectedClassIds: [],
          parentPhone: '',
          homeTown: '',
          gradeLevel: 'Lớp 12',
          targetUniversity: 'HAU',
          customUniversity: '',
          examBlock: 'KHOI_V',
          studyGoal: 'Thi Đại Học',
          facebookUrl: '',
          otherNotes: '',
          totalSessionsInMonth: 12,
          remainingSessions: 12,
        });
        toast.success('Thêm hồ sơ học viên thành công');
        await loadStudents(page, pageSize, searchTerm);
      } else {
        toast.error(data.error || 'Thêm học viên thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi kết nối máy chủ');
    } finally {
      setAddLoading(false);
    }
  };

  const confirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/students?id=${studentToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã xoá học viên thành công');
        setStudentToDelete(null);
        await loadStudents(page, pageSize, searchTerm);
      } else {
        toast.error(data.error || 'Xoá học viên thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEnrollChange = async (classId: string, action: 'ENROLL' | 'UNENROLL') => {
    if (!selectedStudent) return;
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          studentId: selectedStudent.id,
          action,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || (action === 'ENROLL' ? 'Đã đăng ký lớp' : 'Đã huỷ đăng ký lớp'));
        let updatedClasses = [...(selectedStudent.enrolledClassIds || [])];
        if (action === 'ENROLL') {
          updatedClasses.push(classId);
        } else {
          updatedClasses = updatedClasses.filter((id) => id !== classId);
        }
        const updatedSt = { ...selectedStudent, enrolledClassIds: updatedClasses };
        setSelectedStudent(updatedSt);
        setStudents((prev) => prev.map((s) => (s.id === updatedSt.id ? updatedSt : s)));
      } else {
        toast.error(data.error || 'Thao tác thất bại');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi mạng');
    }
  };

  const copyHandoverText = () => {
    if (!createdStudentInfo) return;
    const handoverText = `THÔNG TIN TÀI KHOẢN HỌC VIÊN
Họ và tên: ${createdStudentInfo.name}
Mã học sinh: ${createdStudentInfo.id}
Tên đăng nhập: ${createdStudentInfo.username}
Mật khẩu mặc định: ${createdStudentInfo.defaultPassword}
Hệ thống học tập: https://student-management.local
Lưu ý: Vui lòng đăng nhập và đổi mật khẩu trong lần đầu sử dụng.`;

    navigator.clipboard.writeText(handoverText);
    setCopiedHandover(true);
    toast.success('Đã sao chép thông tin bàn giao');
    setTimeout(() => setCopiedHandover(false), 2500);
  };

  // Lọc trạng thái và mục tiêu trường đã thực hiện ở máy chủ để phân trang chính xác.
  const filteredStudents = students;

  const columns: Column<Student>[] = [
    {
      key: 'id',
      header: 'Mã học viên',
      render: (st) => (
        <span className="font-mono font-bold text-foreground tabular">{st.id}</span>
      ),
    },
    {
      key: 'name',
      header: 'Họ và tên',
      render: (st) => (
        <div>
          <div
            className="font-semibold text-foreground cursor-pointer hover:text-primary transition-colors"
            onClick={() => setQuickStudentId(st.id)}
            title="Xem thông tin học sinh"
          >
            {st.name}
          </div>
          {st.gradeLevel && (
            <span className="text-[12px] text-muted-foreground">{st.gradeLevel}</span>
          )}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Liên hệ',
      render: (st) => (
        <span className="font-mono text-[13px] text-muted-foreground">{st.phone || '—'}</span>
      ),
    },
    {
      key: 'target',
      header: 'Khối & mục tiêu',
      render: (st) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge tone={st.examBlock === 'KHOI_H' ? 'warning' : 'neutral'}>
            {st.examBlock === 'KHOI_H' ? 'Khối H' : 'Khối V'}
          </Badge>
          <span className="text-xs font-semibold text-foreground">
            {st.targetUniversity === 'KHAC'
              ? st.customUniversity || 'Trường khác'
              : st.targetUniversity || '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'classes',
      header: 'Lớp đang học',
      render: (st) => {
        const enrolled = st.enrolledClassIds || [];
        if (enrolled.length === 0) {
          return <span className="text-xs text-subtle-foreground italic">Chưa gán lớp</span>;
        }
        return (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {enrolled.map((cid) => (
              <span
                key={cid}
                className="px-1.5 py-0.5 rounded-field bg-muted text-foreground text-[11px] font-mono font-semibold border border-line"
              >
                {cid}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'sessions',
      header: 'Số buổi',
      align: 'center',
      render: (st) => {
        const remaining = st.remainingSessions ?? st.totalSessionsInMonth ?? 12;
        return (
          <div className="inline-flex items-center gap-1 bg-muted border border-line rounded-pill p-1">
            <button
              type="button"
              onClick={(e) => handleQuickAdjustSessions(st, -1, e)}
              title="Giảm 1 buổi"
              className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
            >
              <Minus size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingSessionStudent(st);
                setEditSessionInput(remaining);
              }}
              title="Bấm để chỉnh sửa số buổi"
              className="cursor-pointer"
            >
              <Badge tone={getSessionTone(remaining)} dot>
                {remaining} buổi
              </Badge>
            </button>
            <button
              type="button"
              onClick={(e) => handleQuickAdjustSessions(st, 1, e)}
              title="Thêm 1 buổi"
              className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
            >
              <Plus size={12} />
            </button>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (st) => (
        <div className="flex items-center gap-2">
          <Badge tone={getStatusTone(st.status)} dot>
            {st.status}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-primary px-2 h-8"
            onClick={() => setStatusStudent(st)}
          >
            Đổi
          </Button>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (st) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            icon={<BookOpen size={14} />}
            onClick={() => setSelectedStudent(st)}
          >
            Gán lớp
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-danger hover:bg-danger-soft h-9 w-9"
            onClick={() => setStudentToDelete(st)}
            aria-label="Xoá học viên"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Quản lý học viên"
          subtitle="Hồ sơ học sinh chuẩn hóa và tiếp nhận nhanh"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Tab trạng thái học tập */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <SegmentedControl
              items={STATUS_OPTIONS}
              value={statusTab}
              onChange={(val) => {
                setStatusTab(val as typeof statusTab);
                setPage(1);
              }}
            />
          </div>

          {/* Bộ lọc theo trường ĐH & khối thi */}
          <Card padded className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FolderKanban size={14} />
                Lọc theo mục tiêu trường và khối thi
              </span>
              <span className="text-[12px] text-subtle-foreground font-mono">
                {total} học viên
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {TARGET_UNI_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setTargetUniFilter(f.id);
                    setPage(1);
                  }}
                  className={`px-3 h-8 rounded-pill text-[12px] font-semibold transition-all cursor-pointer border ${
                    targetUniFilter === f.id
                      ? 'bg-primary text-white border-primary shadow-primary'
                      : 'bg-card text-muted-foreground border-line hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Thanh công cụ tìm kiếm và các nút thêm */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <SearchInput
              placeholder="Tìm mã, họ tên, số điện thoại..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full sm:w-80"
            />

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
              <div className="text-xs text-muted-foreground font-medium hidden md:block">
                Tổng số: <span className="font-bold font-mono text-foreground">{total}</span> hồ sơ
              </div>
              <Button
                variant="secondary"
                icon={<Plus size={15} />}
                onClick={() => setShowAddModal(true)}
              >
                Hồ sơ chi tiết
              </Button>
              <Button
                variant="primary"
                icon={<Zap size={15} />}
                onClick={() => setShowFastModal(true)}
              >
                Tiếp nhận nhanh
              </Button>
            </div>
          </div>

          {/* Bảng dữ liệu học viên */}
          <DataTable
            columns={columns}
            rows={filteredStudents}
            rowKey={(st) => st.id}
            loading={loading}
            emptyTitle="Không tìm thấy học viên"
            emptyDescription="Thử thay đổi từ khóa tìm kiếm hoặc điều chỉnh bộ lọc trạng thái."
            footer={
              <Pager
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={handlePageSizeChange}
              />
            }
            renderMobile={(st) => {
              const remaining = st.remainingSessions ?? st.totalSessionsInMonth ?? 12;
              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div
                        className="font-semibold text-foreground text-[15px] cursor-pointer hover:text-primary transition-colors"
                        onClick={() => setQuickStudentId(st.id)}
                        title="Xem thông tin học sinh"
                      >
                        {st.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[12px] font-bold text-muted-foreground">{st.id}</span>
                        {st.gradeLevel && (
                          <span className="text-[12px] text-muted-foreground">• {st.gradeLevel}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStatusStudent(st)}
                      title="Đổi trạng thái"
                      className="cursor-pointer"
                    >
                      <Badge tone={getStatusTone(st.status)} dot>
                        {st.status}
                      </Badge>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Liên hệ</span>
                      <span className="font-mono font-medium text-foreground">{st.phone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Khối & Trường</span>
                      <span className="font-medium text-foreground">
                        {st.examBlock === 'KHOI_H' ? 'Khối H' : 'Khối V'} — {st.targetUniversity || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-line">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleQuickAdjustSessions(st, -1, e)}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                      >
                        <Minus size={12} />
                      </button>
                      <Badge tone={getSessionTone(remaining)} dot>
                        {remaining} buổi
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => handleQuickAdjustSessions(st, 1, e)}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<BookOpen size={14} />}
                        onClick={() => setSelectedStudent(st)}
                      >
                        Gán lớp
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-danger h-8 w-8"
                        onClick={() => setStudentToDelete(st)}
                        aria-label="Xoá học viên"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </main>

        {/* Sheet Đổi Trạng Thái Học Viên */}
        <Sheet
          isOpen={!!statusStudent}
          onClose={() => setStatusStudent(null)}
          title="Trạng thái học tập"
          description={
            statusStudent ? statusStudent.name + ' (' + statusStudent.id + ')' : undefined
          }
          size="sm"
        >
          {statusStudent && (
            <div className="space-y-2.5 pt-1">
              <p className="text-[13px] text-muted-foreground">
                Chọn trạng thái mới cho học viên. Thay đổi được lưu ngay.
              </p>
              {STUDENT_STATUSES.map((s) => {
                const active = statusStudent.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={active || isUpdatingStatus}
                    onClick={async () => {
                      await handleRowStatusChange(statusStudent, s);
                      setStatusStudent(null);
                    }}
                    className={
                      'w-full h-12 px-4 rounded-field border text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer disabled:cursor-default ' +
                      (active
                        ? 'bg-primary-soft border-primary/40 text-primary-ink'
                        : 'bg-card border-line hover:bg-muted text-foreground')
                    }
                  >
                    <span>{s}</span>
                    <Badge tone={getStatusTone(s)} dot>
                      {active ? 'Hiện tại' : 'Chọn'}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Sheet>

        <Sheet
          isOpen={!!editingSessionStudent}
          onClose={() => setEditingSessionStudent(null)}
          title="Điều chỉnh số buổi học"
          description={
            editingSessionStudent
              ? `${editingSessionStudent.name} (${editingSessionStudent.id})`
              : undefined
          }
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setEditingSessionStudent(null)}>
                Hủy
              </Button>
              <Button variant="primary" onClick={handleUpdateRemainingSessions}>
                Lưu thay đổi
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field
              label="Số buổi học còn lại"
              hint="Dùng để đối soát điểm danh và thông báo học phí chu kỳ tiếp theo."
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setEditSessionInput((prev) => Math.max(0, prev - 1))}
                >
                  <Minus size={16} />
                </Button>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={editSessionInput}
                  onChange={(e) => setEditSessionInput(parseInt(e.target.value) || 0)}
                  className="text-center font-mono font-bold text-base"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setEditSessionInput((prev) => prev + 1)}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </Field>
          </div>
        </Sheet>

        {/* Sheet 1-Click Fast Onboarding */}
        <Sheet
          isOpen={showFastModal}
          onClose={() => setShowFastModal(false)}
          title="Tiếp nhận nhanh học viên"
          description="Hệ thống tự động cấp mã và thông tin tài khoản đăng nhập"
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setShowFastModal(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={fastLoading}
                icon={<Zap size={15} />}
                onClick={handleFastOnboarding}
              >
                Khởi tạo tài khoản
              </Button>
            </div>
          }
        >
          <form onSubmit={handleFastOnboarding} className="space-y-4">
            <Field label="Họ và tên học sinh" required>
              <Input
                required
                placeholder="Ví dụ: Nguyễn Hoàng Nam"
                value={fastData.name}
                onChange={(e) => setFastData({ ...fastData, name: e.target.value })}
                autoFocus
              />
            </Field>

            <Field label="Số điện thoại" hint="Tùy chọn, dùng để liên hệ và tra cứu">
              <Input
                placeholder="0987..."
                value={fastData.phone}
                onChange={(e) => setFastData({ ...fastData, phone: e.target.value })}
              />
            </Field>

            <div className="p-3.5 bg-muted rounded-card border border-line space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Thiết lập tự động:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Mã học sinh tự sinh dạng số chuẩn hóa</li>
                <li>Tài khoản người dùng: tên đăng nhập trùng mã, mật khẩu mặc định 123456</li>
                <li>Hiển thị thẻ bàn giao ngay sau khi tạo xong</li>
              </ul>
            </div>
          </form>
        </Sheet>

        {/* Sheet Kết Quả Bàn Giao Tài Khoản */}
        <Sheet
          isOpen={!!createdStudentInfo}
          onClose={() => setCreatedStudentInfo(null)}
          title="Thông tin bàn giao tài khoản"
          description="Gửi thông tin này cho học viên để đăng nhập vào hệ thống"
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="primary"
                icon={copiedHandover ? <Check size={16} /> : <Copy size={16} />}
                onClick={copyHandoverText}
              >
                {copiedHandover ? 'Đã sao chép' : 'Sao chép thông tin'}
              </Button>
              <Button variant="secondary" onClick={() => setCreatedStudentInfo(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          {createdStudentInfo && (
            <div className="space-y-3">
              <div className="bg-muted p-4 rounded-card border border-line space-y-2.5 text-sm font-mono">
                <div className="flex justify-between border-b border-line pb-2 font-sans">
                  <span className="text-muted-foreground">Họ và tên:</span>
                  <span className="font-bold text-foreground">{createdStudentInfo.name}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-muted-foreground font-sans">Mã học sinh:</span>
                  <span className="font-bold text-primary">{createdStudentInfo.id}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-muted-foreground font-sans">Tên đăng nhập:</span>
                  <span className="font-bold text-foreground">{createdStudentInfo.username}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-muted-foreground font-sans">Mật khẩu mặc định:</span>
                  <Badge tone="success">{createdStudentInfo.defaultPassword}</Badge>
                </div>
                {createdStudentInfo.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-sans">Số điện thoại:</span>
                    <span className="text-foreground">{createdStudentInfo.phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </Sheet>

        {/* Sheet Thêm Học Viên Chi Tiết */}
        <Sheet
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Thêm hồ sơ học viên chi tiết"
          description="Điền thông tin nhân thân, mục tiêu thi cử và lớp đăng ký ban đầu"
          size="lg"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                Hủy
              </Button>
              <Button variant="primary" loading={addLoading} onClick={handleCreateStudent}>
                Tạo hồ sơ
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateStudent} className="space-y-4">
            <Field label="Họ và tên" required>
              <Input
                required
                placeholder="Ví dụ: Lê Minh Hoàng"
                value={newStudentData.name}
                onChange={(e) => setNewStudentData({ ...newStudentData, name: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Số điện thoại">
                <Input
                  placeholder="0987..."
                  value={newStudentData.phone}
                  onChange={(e) => setNewStudentData({ ...newStudentData, phone: e.target.value })}
                />
              </Field>
              <Field label="Giới tính">
                <Select
                  value={newStudentData.gender}
                  onChange={(e) =>
                    setNewStudentData({
                      ...newStudentData,
                      gender: e.target.value as 'Nam' | 'Nữ',
                    })
                  }
                >
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Ngày sinh">
                <Input
                  type="date"
                  value={newStudentData.dateOfBirth}
                  onChange={(e) => setNewStudentData({ ...newStudentData, dateOfBirth: e.target.value })}
                />
              </Field>
              <Field label="Địa chỉ hiện tại">
                <Input
                  placeholder="TP. Hà Nội"
                  value={newStudentData.address}
                  onChange={(e) => setNewStudentData({ ...newStudentData, address: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Quê quán / Tỉnh thành">
                <Input
                  placeholder="Ví dụ: Nam Định, Hà Nội..."
                  value={newStudentData.homeTown}
                  onChange={(e) => setNewStudentData({ ...newStudentData, homeTown: e.target.value })}
                />
              </Field>
              <Field label="SĐT / Zalo phụ huynh">
                <Input
                  type="tel"
                  placeholder="0987..."
                  value={newStudentData.parentPhone}
                  onChange={(e) => setNewStudentData({ ...newStudentData, parentPhone: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Lớp hiện tại" required>
                <Select
                  value={newStudentData.gradeLevel}
                  onChange={(e) => setNewStudentData({ ...newStudentData, gradeLevel: e.target.value })}
                >
                  <option value="Lớp 10">Lớp 10</option>
                  <option value="Lớp 11">Lớp 11</option>
                  <option value="Lớp 12">Lớp 12 (Thi năm nay)</option>
                  <option value="Thí sinh tự do">Thí sinh tự do</option>
                  <option value="Học năng khiếu">Học năng khiếu</option>
                </Select>
              </Field>

              <Field label="Khối thi" required>
                <Select
                  value={newStudentData.examBlock}
                  onChange={(e) =>
                    setNewStudentData({
                      ...newStudentData,
                      examBlock: e.target.value as 'KHOI_V' | 'KHOI_H',
                    })
                  }
                >
                  <option value="KHOI_V">Khối V (Vẽ Mỹ thuật)</option>
                  <option value="KHOI_H">Khối H (Bố cục màu)</option>
                </Select>
              </Field>

              <Field label="Trường mục tiêu" required>
                <Select
                  value={newStudentData.targetUniversity}
                  onChange={(e) => setNewStudentData({ ...newStudentData, targetUniversity: e.target.value })}
                >
                  <option value="HAU">ĐH Kiến Trúc Hà Nội (HAU)</option>
                  <option value="HUCE">ĐH Xây Dựng (HUCE)</option>
                  <option value="MTCN">ĐH Mỹ Thuật Công Nghiệp (MTCN)</option>
                  <option value="NUAE">ĐH Sư Phạm Nghệ Thuật TW (NUAE)</option>
                  <option value="HNUE">ĐH Sư Phạm Hà Nội (HNUE)</option>
                  <option value="VNUFA">ĐH Mỹ Thuật Việt Nam (VNUFA)</option>
                  <option value="HOU">Viện ĐH Mở Hà Nội (HOU)</option>
                  <option value="VNU-SIS">ĐHQGHN (VNU-SIS)</option>
                  <option value="KHAC">Trường khác</option>
                </Select>
              </Field>
            </div>

            {newStudentData.targetUniversity === 'KHAC' && (
              <Field label="Tên trường khác" required>
                <Input
                  required
                  placeholder="Ví dụ: ĐH Bách Khoa, Du học..."
                  value={newStudentData.customUniversity}
                  onChange={(e) => setNewStudentData({ ...newStudentData, customUniversity: e.target.value })}
                />
              </Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Mục đích học">
                <Input
                  placeholder="Ví dụ: Thi Đại học..."
                  value={newStudentData.studyGoal}
                  onChange={(e) => setNewStudentData({ ...newStudentData, studyGoal: e.target.value })}
                />
              </Field>
              <Field label="Số buổi đăng ký ban đầu">
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={newStudentData.remainingSessions}
                  onChange={(e) =>
                    setNewStudentData({
                      ...newStudentData,
                      remainingSessions: Number(e.target.value),
                      totalSessionsInMonth: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>

            <Field label="Link Facebook">
              <Input
                type="url"
                placeholder="https://facebook.com/..."
                value={newStudentData.facebookUrl}
                onChange={(e) => setNewStudentData({ ...newStudentData, facebookUrl: e.target.value })}
              />
            </Field>

            <Field label="Ghi chú thêm">
              <Textarea
                rows={2}
                placeholder="Ghi chú năng khiếu, mục tiêu, nguyện vọng..."
                value={newStudentData.otherNotes}
                onChange={(e) => setNewStudentData({ ...newStudentData, otherNotes: e.target.value })}
              />
            </Field>

            <Field label="Gán vào lớp học ban đầu">
              <div className="border border-line rounded-card p-3 max-h-40 overflow-y-auto space-y-2 bg-muted/40">
                {classes.map((cls) => (
                  <label
                    key={cls.id}
                    className="flex items-center gap-2 p-1.5 rounded-field hover:bg-card transition-colors cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={newStudentData.selectedClassIds.includes(cls.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewStudentData((prev) => ({
                            ...prev,
                            selectedClassIds: [...prev.selectedClassIds, cls.id],
                          }));
                        } else {
                          setNewStudentData((prev) => ({
                            ...prev,
                            selectedClassIds: prev.selectedClassIds.filter((id) => id !== cls.id),
                          }));
                        }
                      }}
                      className="rounded border-line text-primary focus:ring-primary"
                    />
                    <span className="font-mono font-bold text-foreground">{cls.id}</span>
                    <span className="text-muted-foreground">- {cls.name}</span>
                  </label>
                ))}
                {classes.length === 0 && (
                  <p className="text-xs text-subtle-foreground">Chưa có lớp học nào trong hệ thống.</p>
                )}
              </div>
            </Field>
          </form>
        </Sheet>

        {/* Sheet Gán Lớp Cho Học Viên */}
        <Sheet
          isOpen={!!selectedStudent}
          onClose={() => setSelectedStudent(null)}
          title="Phân lớp học viên"
          description={
            selectedStudent
              ? `${selectedStudent.name} (${selectedStudent.id})`
              : undefined
          }
          size="lg"
          footer={
            <div className="flex items-center justify-end w-full">
              <Button variant="secondary" onClick={() => setSelectedStudent(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Danh sách lớp học trong hệ thống:
            </p>
            <div className="divide-y divide-line border border-line rounded-card overflow-hidden">
              {classes.map((cls) => {
                const isEnrolled = (selectedStudent?.enrolledClassIds || []).includes(cls.id);
                return (
                  <div
                    key={cls.id}
                    className="p-3.5 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                        <span>{cls.name}</span>
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-line">
                          {cls.id}
                        </span>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">
                        Lịch: Thứ {cls.scheduleDays?.join(', ') || '—'} •{' '}
                        {formatClassTimeLabel(cls)}
                      </div>
                    </div>

                    {isEnrolled ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleEnrollChange(cls.id, 'UNENROLL')}
                      >
                        Hủy đăng ký
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleEnrollChange(cls.id, 'ENROLL')}
                      >
                        Đăng ký lớp
                      </Button>
                    )}
                  </div>
                );
              })}
              {classes.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Chưa có lớp học nào trong hệ thống.
                </div>
              )}
            </div>
          </div>
        </Sheet>

        {/* Sheet Xác Nhận Xoá Học Viên */}
        <Sheet
          isOpen={!!studentToDelete}
          onClose={() => setStudentToDelete(null)}
          title="Xác nhận xoá học viên"
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setStudentToDelete(null)}>
                Hủy
              </Button>
              <Button
                variant="danger"
                loading={isDeleting}
                onClick={confirmDeleteStudent}
              >
                Xác nhận xoá
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Bạn có chắc chắn muốn xoá học viên{' '}
              <strong className="text-foreground">{studentToDelete?.name}</strong> (
              <span className="font-mono">{studentToDelete?.id}</span>)?
            </p>
            <p className="text-xs text-muted-foreground">
              Học viên sẽ bị xoá khỏi toàn bộ danh sách lớp học liên quan. Hành động này không thể hoàn tác.
            </p>
          </div>
        </Sheet>
      <QuickStudentModal studentId={quickStudentId} onClose={() => setQuickStudentId(null)} />
      </div>
    </RoleGuard>
  );
}
