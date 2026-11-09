'use client';

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  GraduationCap,
  Users,
  Video,
  DollarSign,
  UserCheck,
  CheckCircle2,
  CalendarDays,
} from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { ScheduleSlot } from '@/types/schedule';
import { formatTimeHM } from '@/utils/date';

export interface QuickClassModalProps {
  classId: string | null;
  slot?: ScheduleSlot | null;
  onClose: () => void;
}

const DAY_LABELS: Record<number, string> = {
  2: 'Thứ 2',
  3: 'Thứ 3',
  4: 'Thứ 4',
  5: 'Thứ 5',
  6: 'Thứ 6',
  7: 'Thứ 7',
  8: 'Chủ Nhật',
};

export function QuickClassModal({ classId, slot, onClose }: QuickClassModalProps) {
  const [classData, setClassData] = useState<ClassEntity | null>(null);
  const [sections, setSections] = useState<ClassSection[]>([]);
  const [teacherName, setTeacherName] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!classId) {
      setClassData(null);
      setSections([]);
      setTeacherName('');
      return;
    }

    async function loadClassInfo() {
      setLoading(true);
      try {
        const [clsRes, secRes, tcRes] = await Promise.all([
          fetch(`/api/classes?id=${classId}`),
          fetch(`/api/classes/sections?classId=${classId}`).catch(() => null),
          fetch('/api/teachers').catch(() => null),
        ]);

        if (clsRes.ok) {
          const cData = await clsRes.json();
          const cls = cData.class;
          setClassData(cls);

          if (cls?.teacherId && tcRes && tcRes.ok) {
            const tData = await tcRes.json();
            const teacher = (tData.teachers || []).find((t: any) => t.id === cls.teacherId);
            if (teacher) {
              setTeacherName(teacher.name);
            } else {
              setTeacherName(cls.teacherId);
            }
          } else if (cls?.teacherId) {
            setTeacherName(cls.teacherId);
          }
        }

        if (secRes && secRes.ok) {
          const sData = await secRes.json();
          setSections(sData.sections || []);
        }
      } catch (err) {
        console.error('Lỗi khi nạp thông tin lớp học:', err);
      } finally {
        setLoading(false);
      }
    }

    loadClassInfo();
  }, [classId]);

  if (!classId) return null;

  const meetingLink = slot?.meetingLink || classData?.meetingLink;
  const studentCount = classData?.studentCount ?? classData?.studentIds?.length ?? 0;
  const daysFormatted = (classData?.scheduleDays || [])
    .map((d) => DAY_LABELS[d] || `T${d}`)
    .join(', ');

  return (
    <Sheet
      isOpen={!!classId}
      onClose={onClose}
      title={classData ? classData.name : `Lớp ${classId}`}
      description={classData?.subject ? `Môn học: ${classData.subject} • Mã lớp: ${classId}` : `Mã lớp: ${classId}`}
      size="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          {meetingLink && (
            <a
              href={meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-primary text-white text-[13px] font-semibold hover:bg-primary-ink transition shadow-primary"
            >
              <Video size={14} />
              <span>Vào phòng học</span>
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Đang nạp thông tin lớp học…
        </div>
      ) : classData ? (
        <div className="space-y-4 pt-1">
          {/* Header trạng thái */}
          <div className="flex items-center justify-between gap-2 p-3 rounded-card bg-muted/40 border border-line">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-mono font-bold px-2 py-0.5 rounded bg-card text-foreground border border-line">
                {classData.id}
              </span>
              <Badge
                tone={
                  classData.status === 'Đang mở'
                    ? 'success'
                    : classData.status === 'Sắp khai giảng'
                    ? 'info'
                    : 'neutral'
                }
                dot
              >
                {classData.status}
              </Badge>
              {classData.subject && (
                <Badge tone="primary">{classData.subject}</Badge>
              )}
            </div>
            <div className="text-[13px] font-bold text-foreground tabular">
              {studentCount} học viên
            </div>
          </div>

          {/* Chi tiết buổi học cụ thể nếu được mở từ TKB */}
          {slot && (
            <div className="p-3.5 rounded-card bg-primary-soft/40 border border-primary/20 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary-ink flex items-center gap-1">
                  <CalendarDays size={13} /> Buổi học được chọn
                </span>
                <span className="text-[11px] font-mono font-bold text-primary-ink tabular">
                  {slot.date}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Clock size={14} className="text-primary" />
                  {formatTimeHM(slot.startTime)} – {formatTimeHM(slot.endTime)}
                </span>
                <Badge tone="neutral">{slot.status}</Badge>
              </div>
              {slot.topic && (
                <p className="text-[12px] text-muted-foreground mt-1 pt-1 border-t border-primary/10">
                  <strong>Chủ đề:</strong> {slot.topic}
                </p>
              )}
            </div>
          )}

          {/* Lưới thông tin lớp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-card border border-line bg-card space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <UserCheck size={13} className="text-primary" /> Giáo viên phụ trách
              </div>
              <p className="font-bold text-foreground">
                {teacherName || classData.teacherId || 'Chưa phân công'}
              </p>
            </div>

            <div className="p-3 rounded-card border border-line bg-card space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <DollarSign size={13} className="text-primary" /> Học phí khóa học
              </div>
              <p className="font-bold text-foreground tabular">
                {Number(classData.tuitionFee || 0).toLocaleString('vi-VN')} đ
              </p>
            </div>

            <div className="p-3 rounded-card border border-line bg-card space-y-1 sm:col-span-2">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Calendar size={13} className="text-primary" /> Lịch học định kỳ trong tuần
              </div>
              <p className="font-bold text-foreground">
                {daysFormatted || 'Chưa cố định'}
                {classData.startTime && classData.endTime && (
                  <span className="text-muted-foreground font-normal ml-2">
                    ({formatTimeHM(classData.startTime)} – {formatTimeHM(classData.endTime)})
                  </span>
                )}
              </p>
            </div>

            <div className="p-3 rounded-card border border-line bg-card space-y-1 sm:col-span-2">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Video size={13} className="text-primary" /> Phòng học trực tuyến
              </div>
              {meetingLink ? (
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono text-[13px] truncate"
                  >
                    {meetingLink}
                  </a>
                  <a
                    href={meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"
                  >
                    Mở link <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  Lớp học trực tiếp tại trung tâm (không có link online)
                </p>
              )}
            </div>
          </div>

          {/* Các ca học của lớp (sections) */}
          {sections.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Clock size={13} /> Các ca học của lớp ({sections.length} ca)
              </h4>
              <div className="space-y-1.5">
                {sections.map((sec) => (
                  <div
                    key={sec.id}
                    className="flex items-center justify-between p-2.5 rounded-field border border-line bg-card text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-foreground truncate">{sec.name}</p>
                      <p className="text-muted-foreground tabular">
                        {sec.startTime && sec.endTime
                          ? `${formatTimeHM(sec.startTime)} – ${formatTimeHM(sec.endTime)}`
                          : 'Giờ linh hoạt'}
                      </p>
                    </div>
                    <Badge tone={sec.isActive ? 'neutral' : 'warning'}>
                      {sec.isActive ? 'Đang mở' : 'Tạm dừng'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen size={24} />}
          title="Không tìm thấy thông tin lớp"
          description={`Không tìm thấy dữ liệu cho mã lớp ${classId}.`}
        />
      )}
    </Sheet>
  );
}
