'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { TimeShift, TIME_SHIFTS } from '@/types/schedule';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Badge } from '@/components/ui/Badge';
import { Sheet } from '@/components/ui/Sheet';
import { SegmentedControl } from '@/components/ui/Tabs';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import {
  BookOpen,
  Users,
  MapPin,
  Clock,
  UserCheck,
  Sparkles,
  ChevronRight,
  Plus,
  Calendar,
  Video,
  ExternalLink,
  Phone,
} from 'lucide-react';

interface SectionItem {
  section: ClassSection;
  cls: ClassEntity;
}

export default function TeacherClassesPage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();
  const [allClasses, setAllClasses] = useState<ClassEntity[]>([]);
  const [sections, setSections] = useState<ClassSection[]>([]);
  const [selectedClassForView, setSelectedClassForView] = useState<ClassEntity | null>(null);
  const [classStudents, setClassStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [shifts, setShifts] = useState<TimeShift[]>(TIME_SHIFTS);
  const [loading, setLoading] = useState(true);
  const [claimingSectionId, setClaimingSectionId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'MINE' | 'AVAILABLE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);
  const [viewSection, setViewSection] = useState<ClassSection | null>(null);
  const [filterDay, setFilterDay] = useState<number | null>(null);

  const loadData = async () => {
    if (!isReady || !currentUser?.id) return;
    setLoading(true);
    try {
      const [clsRes, shiftRes, secRes] = await Promise.all([
        fetch('/api/classes'),
        fetch('/api/shifts'),
        fetch('/api/classes/sections?teacherId=' + currentUser.id),
      ]);
      const clsData = await clsRes.json();
      const shiftData = await shiftRes.json();
      const secData = await secRes.json();

      setAllClasses(clsData.classes || []);
      if (shiftData.shifts) setShifts(shiftData.shifts);
      setSections((secData.sections || []) as ClassSection[]);
    } catch (e) {
      console.error(e);
      toast.error('Không thể tải dữ liệu lớp học.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser, isReady]);

  const handleOpenClassStudents = async (cls: ClassEntity, section?: ClassSection) => {
    setSelectedClassForView(cls);
    setViewSection(section || null);
    setFilterDay(null);
    setLoadingStudents(true);
    try {
      const res = await fetch('/api/students?limit=1000');
      const data = await res.json();
      const allSt = data.students || [];
      const rosterIds = section?.studentIds?.length ? section.studentIds : (cls.studentIds || []);
      const enrolled = allSt
        .filter((s: any) => rosterIds.includes(s.id))
        .map((s: any, i: number) => ({ ...s, _idx: i + 1 }));
      setClassStudents(enrolled);
    } catch (e) {
      console.error(e);
      toast.error('Không thể tải danh sách học viên.');
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleClaimSection = async (item: SectionItem) => {
    if (!currentUser?.id) return;
    setClaimingSectionId(item.section.id);
    try {
      const res = await fetch('/api/classes/sections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: item.section.id,
          teacherId: currentUser.id,
          syncFutureSlots: true,

        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Đã nhận ca dạy lớp ' + item.cls.name + ' thành công.');
        await loadData();
      } else {
        toast.error(data.error || 'Nhận ca dạy thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối khi nhận ca dạy.');
    } finally {
      setClaimingSectionId(null);
    }
  };

  const allItems: SectionItem[] = useMemo(() => {
    const list: SectionItem[] = [];
    const map = new Map(allClasses.map((c) => [c.id, c]));
    for (const s of sections) {
      const cls = map.get(s.classId);
      if (cls) list.push({ section: s, cls });
    }
    return list;
  }, [allClasses, sections]);

  const myItems = useMemo(
    () => allItems.filter((i) => i.section.teacherId === currentUser?.id),
    [allItems, currentUser?.id]
  );

  const availableItems = useMemo(
    () =>
      allItems.filter(
        (i) => !i.section.teacherId || i.section.teacherId === 'CHUA_PHAN_CONG' || i.section.teacherId === ''
      ),
    [allItems]
  );

  const displayedItems = useMemo(() => {
    return allItems.filter((i) => {
      if (filterMode === 'MINE' && i.section.teacherId !== currentUser?.id) return false;
      if (
        filterMode === 'AVAILABLE' &&
        i.section.teacherId &&
        i.section.teacherId !== 'CHUA_PHAN_CONG' &&
        i.section.teacherId !== ''
      ) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesName = i.cls.name?.toLowerCase().includes(q);
        const matchesSubj = i.cls.subject?.toLowerCase().includes(q);
        return matchesName || matchesSubj;
      }
      return true;
    });
  }, [allItems, filterMode, currentUser?.id, searchTerm]);

  const studentColumns: Column<any>[] = [
    {
      key: 'stt',
      header: '#',
      align: 'center',
      className: 'w-10 text-muted-foreground font-mono text-xs',
      render: (st: any) => st._idx ?? '',
    },
    {
      key: 'student',
      header: 'Học viên',
      render: (st) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={st.name} size={32} />
          <div className="min-w-0">
            <div
              className="font-bold text-foreground text-xs sm:text-sm truncate cursor-pointer hover:text-primary transition-colors"
              onClick={() => setQuickStudentId(st.id)}
              title="Xem thông tin học sinh"
            >
              {st.name}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">{st.id}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'info',
      header: 'Thông tin học tập',
      render: (st) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <div>
            Mục tiêu:{' '}
            <strong className="text-foreground">
              {st.targetUniversity === 'KHAC'
                ? st.customUniversity || 'Khác'
                : st.targetUniversity || 'HAU'}
            </strong>
            {' • '}
            {st.examBlock === 'KHOI_H' ? 'Khối H' : 'Khối V'}
            {' • '}
            {st.gradeLevel || 'Lớp 12'}
          </div>
          {st.homeTown && <div>Quê quán: {st.homeTown}</div>}
          {st.otherNotes && (
            <div className="text-[11px] text-foreground bg-warning-soft px-1.5 py-0.5 rounded-field inline-block">
              {st.otherNotes}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'days',
      header: 'Thứ học',
      align: 'center',
      render: (st) => {
        if (!viewSection) {
          const days = selectedClassForView?.scheduleDays || [];
          return (
            <span className="text-[11px] text-muted-foreground">
              {days.length ? days.map((d) => dayLabel(d)).join(', ') : 'Chưa xếp thứ'}
            </span>
          );
        }
        const days = sectionDaysFor(st.id);
        return (
          <div className="flex flex-wrap gap-1 justify-center">
            {days.length > 0 ? (
              days.map((d) => (
                <span key={d} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                  {dayLabel(d)}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground">Cả tuần</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'sessions',
      header: 'Buổi còn',
      align: 'center',
      render: (st) => (
        <Badge tone="info" className="tabular font-bold">
          Còn {st.remainingSessions ?? 12} buổi
        </Badge>
      ),
    },
    {
      key: 'contact',
      header: 'Liên hệ',
      align: 'right',
      render: (st) => (
        <div className="text-xs font-mono text-muted-foreground flex items-center justify-end gap-1">
          {st.phone ? (
            <>
              <Phone size={11} className="text-muted-foreground" />
              <span>{st.phone}</span>
            </>
          ) : (
            '–'
          )}
        </div>
      ),
    },
  ];

  /** Thứ thực tế của học sinh trong ca: thứ riêng nếu có, rỗng = theo đủ lịch ca. */
  const sectionDaysFor = (studentId: string): number[] => {
    if (!viewSection) return [];
    const own = viewSection.studentScheduleDays?.[studentId];
    if (own && own.length > 0) return own;
    return viewSection.scheduleDays || [];
  };

  const dayLabel = (d: number) => (d === 8 ? 'CN' : 'T' + d);

  const filteredClassStudents = useMemo(() => {
    if (filterDay === null || !viewSection) return classStudents;
    return classStudents.filter((st) => sectionDaysFor(st.id).includes(filterDay));
  }, [classStudents, filterDay, viewSection]);

  return (
    <RoleGuard allowedRoles={['TEACHER', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Lớp học & ca dạy"
          subtitle={'Giảng viên ' + (currentUser?.name || '') + ' (' + (currentUser?.id || '') + ') • Quản lý các ca phụ trách'}
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              label="Ca bạn đang dạy"
              value={myItems.length}
              hint="Ca học phụ trách trực tiếp"
              icon={<UserCheck size={18} />}
              tone="primary"
            />
            <StatCard
              label="Ca mở chờ nhận"
              value={availableItems.length}
              hint="Có thể nhận dạy thêm"
              icon={<Sparkles size={18} />}
              tone="success"
            />
            <StatCard
              label="Tổng số ca học"
              value={allItems.length}
              hint="Toàn bộ ca của trung tâm"
              icon={<BookOpen size={18} />}
              tone="info"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <SegmentedControl
              value={filterMode}
              onChange={setFilterMode}
              items={[
                { value: 'ALL', label: 'Tất cả ca học', count: allItems.length },
                { value: 'MINE', label: 'Ca bạn đang dạy', count: myItems.length },
                { value: 'AVAILABLE', label: 'Ca mở / Trống', count: availableItems.length },
              ]}
            />

            <div className="w-full sm:w-72">
              <SearchInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Tìm tên lớp, môn học, phòng..."
              />
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-64 rounded-card bg-muted animate-pulse border border-line" />
              ))}
            </div>
          ) : displayedItems.length === 0 ? (
            <Card>
              <EmptyState
                icon={<BookOpen size={28} />}
                title="Không tìm thấy ca học nào"
                description={
                  searchTerm
                    ? 'Không có ca học nào khớp với từ khóa tìm kiếm.'
                    : 'Không có ca học nào trong danh mục này.'
                }
                action={
                  searchTerm ? (
                    <Button variant="secondary" size="sm" onClick={() => setSearchTerm('')}>
                      Xóa tìm kiếm
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedItems.map(({ section, cls }) => {
                const isMine = section.teacherId === currentUser?.id;
                const isOpen =
                  !section.teacherId ||
                  section.teacherId === 'CHUA_PHAN_CONG' ||
                  section.teacherId === '';
                const timeLabel =
                  section.startTime && section.endTime
                    ? section.startTime + ' – ' + section.endTime
                    : cls.startTime && cls.endTime
                    ? cls.startTime + ' – ' + cls.endTime
                    : 'Chưa đặt giờ';
                const days = section.scheduleDays && section.scheduleDays.length > 0
                  ? section.scheduleDays
                  : cls.scheduleDays;

                return (
                  <Card
                    key={section.id}
                    className={
                      'flex flex-col justify-between transition-all ' +
                      (isMine ? 'border-primary/40 ring-1 ring-primary/20' : '')
                    }
                  >
                    <div className="space-y-3.5">
                      <CardHeader
                        title={cls.name}
                        subtitle={
                          <>
                            {cls.subject}
                            {section.name ? <span className="opacity-70"> • {section.name}</span> : null}
                          </>
                        }
                        action={
                          isMine ? (
                            <Badge tone="success" dot>
                              Đang dạy
                            </Badge>
                          ) : isOpen ? (
                            <Badge tone="primary" dot>
                              Ca mở
                            </Badge>
                          ) : (
                            <Badge tone="neutral">GV: {section.teacherId}</Badge>
                          )
                        }
                      />

                      <div className="bg-muted rounded-field p-3.5 border border-line space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                            <Clock size={13} className="text-primary" /> Ca & khung giờ:
                          </span>
                          <span className="font-semibold text-foreground tabular">{timeLabel}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                            <Calendar size={13} className="text-primary" /> Lịch trong tuần:
                          </span>
                          <span className="font-semibold text-foreground">
                            {days && days.length > 0 ? 'Thứ ' + days.join(', ') : 'Chưa xếp thứ'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenClassStudents(cls, section)}
                          className="flex items-center justify-between w-full pt-2 border-t border-line hover:text-primary transition cursor-pointer text-left"
                          title="Bấm để xem danh sách học viên"
                        >
                          <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                            <Users size={13} className="text-primary" /> Sĩ số đăng ký:
                          </span>
                          <span className="font-bold text-primary-ink bg-primary-soft px-2 py-0.5 rounded-pill text-xs flex items-center gap-1 tabular">
                            {(section.studentIds?.length ?? cls.studentIds.length)} học viên <ChevronRight size={12} />
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-line mt-4">
                      {isMine ? (
                        <LinkButton
                          href={'/teacher/attendance?classId=' + cls.id}
                          variant="primary"
                          size="md"
                          fullWidth
                          icon={<UserCheck size={16} />}
                          className="block w-full"
                        >
                          Sổ điểm danh & Đánh giá
                        </LinkButton>
                      ) : isOpen ? (
                        <Button
                          variant="primary"
                          size="md"
                          fullWidth
                          loading={claimingSectionId === section.id}
                          onClick={() => handleClaimSection({ section, cls })}
                          icon={<Plus size={16} />}
                        >
                          Nhận ca dạy này
                        </Button>
                      ) : (
                        <div className="w-full py-2.5 bg-muted text-muted-foreground rounded-pill text-xs font-semibold text-center border border-line">
                          Đã phân công: <strong className="text-foreground">{section.teacherId}</strong>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </main>

        <Sheet
          isOpen={!!selectedClassForView}
          onClose={() => setSelectedClassForView(null)}
          title={selectedClassForView ? 'Danh sách học viên: ' + selectedClassForView.name : ''}
          description={
            selectedClassForView
              ? 'Môn: ' + selectedClassForView.subject + ' • ' +
                (viewSection
                  ? viewSection.name + ' (' + (viewSection.startTime || '') + ' - ' + (viewSection.endTime || '') + ')'
                  : 'Thứ ' + (selectedClassForView.scheduleDays?.join(', ') || ''))
              : ''
          }
          size="lg"
          footer={
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 w-full">
              <span className="text-xs text-muted-foreground">
                Xem chi tiết từng buổi và điểm danh tại mục <strong>Sổ điểm danh</strong>.
              </span>
              <Button variant="secondary" size="md" onClick={() => setSelectedClassForView(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          {selectedClassForView && (
            <div className="space-y-4 py-1">
              {selectedClassForView.meetingLink && (
                <div className="flex items-center justify-between p-3 rounded-field bg-primary-soft text-primary-ink text-xs font-semibold">
                  <span>Phòng học trực tuyến Discord/Meet</span>
                  <a
                    href={selectedClassForView.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-bold"
                  >
                    <Video size={13} /> Vào phòng online <ExternalLink size={11} />
                  </a>
                </div>
              )}

              {viewSection && (
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
                  {[2, 3, 4, 5, 6, 7, 8].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFilterDay(filterDay === d ? null : d)}
                      className={
                        'px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition ' +
                        (filterDay === d
                          ? 'bg-primary text-white border-primary'
                          : 'bg-card text-muted-foreground border-line hover:bg-muted')
                      }
                    >
                      {dayLabel(d)}
                    </button>
                  ))}
                </div>
              )}

              <DataTable
                columns={studentColumns}
                rows={filteredClassStudents}
                rowKey={(st) => st.id}
                loading={loadingStudents}
                emptyTitle="Lớp chưa có học viên nào đăng ký"
                emptyDescription="Hiện chưa có học viên nào được ghi danh vào lớp học này."
                emptyIcon={<Users size={24} />}
                renderMobile={(st) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Avatar name={st.name} size={32} />
                      <div className="min-w-0 space-y-1">
                        <div
                          className="font-bold text-foreground text-sm leading-tight truncate cursor-pointer hover:text-primary transition-colors"
                          onClick={() => setQuickStudentId(st.id)}
                          title="Xem thông tin học sinh"
                        >
                          {st.name}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">{st.id}</div>
                        <div className="text-xs text-muted-foreground">
                          Mục tiêu:{' '}
                          {st.targetUniversity === 'KHAC'
                            ? st.customUniversity || 'Khác'
                            : st.targetUniversity || 'HAU'}{' '}
                          • {st.examBlock === 'KHOI_H' ? 'Khối H' : 'Khối V'}
                        </div>
                        {st.phone && (
                          <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            <Phone size={10} />
                            <span>{st.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge tone="info" className="tabular shrink-0">
                      Còn {st.remainingSessions ?? 12} buổi
                    </Badge>
                  </div>
                )}
              />
            </div>
          )}
        </Sheet>
        <QuickStudentModal studentId={quickStudentId} onClose={() => setQuickStudentId(null)} />
      </div>
    </RoleGuard>
  );
}
