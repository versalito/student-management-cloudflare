'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { Modal } from '@/components/common/Modal';
import { ClassRequest, RequestType, RequestStatus, ScheduleSlot, TIME_SHIFTS } from '@/types/schedule';
import { 
  Inbox, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  BookOpen, 
  AlertCircle,
  Check,
  RotateCcw
} from 'lucide-react';

export default function AdminRequestsPage() {
  const { currentUser, isReady } = useApp();
  const [requests, setRequests] = useState<ClassRequest[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  const [allScheduleSlots, setAllScheduleSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | RequestType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | RequestStatus>('ALL');

  // Decision Modal State
  const [decisionModal, setDecisionModal] = useState<{
    isOpen: boolean;
    request: ClassRequest | null;
    action: 'ĐÃ_DUYỆT' | 'TỪ_CHỐI';
    note: string;
    submitting: boolean;
    error: string;
  }>({
    isOpen: false,
    request: null,
    action: 'ĐÃ_DUYỆT',
    note: '',
    submitting: false,
    error: '',
  });

  const loadData = async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      const [reqRes, stuRes, clsRes, schedRes] = await Promise.all([
        fetch('/api/requests'),
        fetch('/api/students?limit=1000'),
        fetch('/api/classes'),
        fetch('/api/schedule'),
      ]);

      const [reqData, stuData, clsData, schedData] = await Promise.all([
        reqRes.json(),
        stuRes.json(),
        clsRes.json(),
        schedRes.json(),
      ]);

      setRequests(reqData.requests || []);
      setAllStudents(stuData.students || []);
      setAllClasses(clsData.classes || []);
      setAllScheduleSlots(schedData.slots || []);
    } catch (e) {
      console.error('Lỗi khi nạp dữ liệu duyệt đơn:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isReady]);

  // Lookup maps
  const studentMap = useMemo(() => {
    return new Map(allStudents.map(s => [s.id, s]));
  }, [allStudents]);

  const classMap = useMemo(() => {
    return new Map(allClasses.map(c => [c.id, c]));
  }, [allClasses]);

  const slotMap = useMemo(() => {
    return new Map(allScheduleSlots.map(s => [s.id, s]));
  }, [allScheduleSlots]);

  // Helpers
  const formatSlotDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const days = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
      const dayName = days[d.getDay()] || '';
      const [year, month, day] = dateStr.split('-');
      return `${dayName}, ${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  const getShiftLabel = (shiftId: number) => {
    const s = TIME_SHIFTS.find(ts => ts.id === shiftId);
    return s ? `${s.name} (${s.startTime} - ${s.endTime})` : `Ca ${shiftId}`;
  };

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      // Type filter
      if (typeFilter !== 'ALL' && req.type !== typeFilter) return false;
      // Status filter
      if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;

      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const student = studentMap.get(req.studentId);
        const cls = classMap.get(req.classId);

        const matchId = req.id.toLowerCase().includes(query);
        const matchStudentId = req.studentId.toLowerCase().includes(query);
        const matchStudentName = student?.name?.toLowerCase().includes(query) || false;
        const matchClassId = req.classId.toLowerCase().includes(query);
        const matchClassName = cls?.name?.toLowerCase().includes(query) || false;
        const matchReason = req.reason.toLowerCase().includes(query);

        return matchId || matchStudentId || matchStudentName || matchClassId || matchClassName || matchReason;
      }

      return true;
    });
  }, [requests, typeFilter, statusFilter, searchTerm, studentMap, classMap]);

  // Open Decision Modal
  const handleOpenDecision = (request: ClassRequest, action: 'ĐÃ_DUYỆT' | 'TỪ_CHỐI') => {
    setDecisionModal({
      isOpen: true,
      request,
      action,
      note: action === 'ĐÃ_DUYỆT' ? 'Đã phê duyệt nguyện vọng của học viên.' : 'Không thể sắp xếp theo nguyện vọng.',
      submitting: false,
      error: '',
    });
  };

  // Submit Decision
  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionModal.request) return;

    setDecisionModal(prev => ({ ...prev, submitting: true, error: '' }));
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DECIDE',
          requestId: decisionModal.request.id,
          status: decisionModal.action,
          reviewerId: currentUser?.id || 'ADMIN001',
          reviewerName: currentUser?.name || 'Ban Giám Hiệu / Quản trị viên',
          reviewerRole: 'ADMIN',
          reviewNote: decisionModal.note.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDecisionModal(prev => ({ ...prev, isOpen: false }));
        await loadData();
      } else {
        setDecisionModal(prev => ({
          ...prev,
          submitting: false,
          error: data.error || 'Có lỗi xảy ra khi cập nhật quyết định duyệt.',
        }));
      }
    } catch (err: any) {
      setDecisionModal(prev => ({
        ...prev,
        submitting: false,
        error: err.message || 'Lỗi mạng hoặc hệ thống.',
      }));
    }
  };

  const pendingCount = requests.filter(r => r.status === 'CHỜ_DUYỆT').length;
  const approvedCount = requests.filter(r => r.status === 'ĐÃ_DUYỆT').length;
  const rejectedCount = requests.filter(r => r.status === 'TỪ_CHỐI').length;

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen bg-slate-50">
        <Header 
          title="Phê duyệt Đơn từ Học viên (Nghỉ học & Đổi ca)" 
          subtitle="Quản lý toàn bộ các yêu cầu xin nghỉ và đổi ca học trong trung tâm" 
        />

        <main className="p-6 max-w-7xl mx-auto w-full space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tổng đơn từ</span>
                <div className="text-2xl font-bold text-slate-800">{requests.length}</div>
              </div>
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                <Inbox size={20} />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Chờ duyệt</span>
                <div className="text-2xl font-bold text-amber-700">{pendingCount}</div>
              </div>
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                <Clock size={20} />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Đã chấp thuận</span>
                <div className="text-2xl font-bold text-emerald-700">{approvedCount}</div>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <CheckCircle size={20} />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider">Đã từ chối</span>
                <div className="text-2xl font-bold text-rose-700">{rejectedCount}</div>
              </div>
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                <XCircle size={20} />
              </div>
            </div>
          </div>

          {/* Filter and Search Controls */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Tìm mã đơn, tên học viên, mã lớp..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-emerald-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-slate-500" />
                <span className="text-xs font-semibold text-slate-600">Loại:</span>
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value as any)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 bg-white"
                >
                  <option value="ALL">Tất cả loại đơn</option>
                  <option value="XIN_NGHI">Đơn xin nghỉ học</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">Trạng thái:</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 bg-white"
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="CHỜ_DUYỆT">Chờ duyệt</option>
                  <option value="ĐÃ_DUYỆT">Đã duyệt</option>
                  <option value="TỪ_CHỐI">Từ chối</option>
                </select>
              </div>

              <button
                onClick={loadData}
                title="Tải lại dữ liệu"
                className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {/* Request Cards List */}
          <div className="space-y-4">
            {filteredRequests.map(req => {
              const student = studentMap.get(req.studentId);
              const cls = classMap.get(req.classId);
              const origSlot = slotMap.get(req.scheduleSlotId);

              return (
                <div 
                  key={req.id} 
                  className={`bg-white rounded-xl border shadow-xs p-5 transition space-y-4 ${
                    req.status === 'CHỜ_DUYỆT' ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200`}>
                        Đơn xin nghỉ học
                      </span>
                      <span className="font-bold text-slate-900 text-sm">
                        Mã đơn: #{req.id}
                      </span>
                      <span className="text-xs text-slate-400">
                        • Gửi lúc: {new Date(req.createdAt).toLocaleDateString('vi-VN')} {new Date(req.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div>
                      <span className={`text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                        req.status === 'ĐÃ_DUYỆT'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'TỪ_CHỐI'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800 animate-pulse'
                      }`}>
                        {req.status === 'ĐÃ_DUYỆT' && <CheckCircle size={14} />}
                        {req.status === 'TỪ_CHỐI' && <XCircle size={14} />}
                        {req.status === 'CHỜ_DUYỆT' && <Clock size={14} />}
                        {req.status}
                      </span>
                    </div>
                  </div>

                  {/* Student & Class Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/70 p-3.5 rounded-xl border border-slate-100 text-xs">
                    <div className="space-y-1">
                      <div className="text-slate-500 font-semibold flex items-center gap-1.5">
                        <User size={14} className="text-slate-400" />
                        Học viên nộp đơn:
                      </div>
                      <div className="font-bold text-slate-900 text-sm">
                        {student?.fullName || `Học viên ${req.studentId}`} 
                        <span className="text-slate-500 text-xs font-normal ml-2">({req.studentId})</span>
                      </div>
                      <div className="text-slate-600 text-[11px]">
                        Email: {student?.email || 'N/A'} • SĐT: {student?.phone || 'N/A'}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-slate-500 font-semibold flex items-center gap-1.5">
                        <BookOpen size={14} className="text-slate-400" />
                        Lớp học & Môn học:
                      </div>
                      <div className="font-bold text-slate-900 text-sm">
                        {cls?.name || req.classId} 
                        <span className="text-slate-500 text-xs font-normal ml-2">({req.classId})</span>
                      </div>
                      <div className="text-slate-600 text-[11px]">
                        Môn: <strong>{cls?.subject || 'Chưa định danh'}</strong> • GV phụ trách: {cls?.teacherId || 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Slot Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white p-3 rounded-xl border border-slate-200 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="font-semibold text-slate-600 flex items-center gap-1 mb-1">
                        <Calendar size={13} className="text-slate-500" />
                        Ca học xin nghỉ phép:
                      </span>
                      {origSlot ? (
                        <div className="text-slate-800 space-y-0.5">
                          <div className="font-bold text-amber-900">
                            📅 {formatSlotDate(origSlot.date)} - {getShiftLabel(origSlot.shiftId)}
                          </div>
                          <div className="text-slate-500 text-[11px]">
                            Phòng: <strong>{origSlot.roomId}</strong> • GV: {origSlot.teacherId} • Môn: {origSlot.subject}
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-600 font-medium">Mã ca: {req.scheduleSlotId}</div>
                      )}
                    </div>
                  </div>

                  {/* Reason & Review Note */}
                  <div className="text-xs text-slate-700 space-y-2">
                    <div>
                      <span className="font-semibold text-slate-600">Lý do của học viên:</span>
                      <p className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 italic text-slate-700 leading-relaxed">
                        "{req.reason}"
                      </p>
                    </div>

                    {req.reviewNote && (
                      <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                        <span className="font-semibold text-emerald-900">
                          Ghi chú duyệt ({req.reviewedBy || 'Admin'}):
                        </span>
                        <p className="mt-0.5 text-emerald-950">{req.reviewNote}</p>
                      </div>
                    )}
                  </div>

                  {/* Admin Action Buttons */}
                  {req.status === 'CHỜ_DUYỆT' && (
                    <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(req, 'TỪ_CHỐI')}
                        className="px-4 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <XCircle size={14} /> Từ chối đơn
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(req, 'ĐÃ_DUYỆT')}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <CheckCircle size={14} /> Chấp thuận duyệt
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredRequests.length === 0 && (
              <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400 space-y-2">
                <Inbox size={32} className="mx-auto text-slate-300" />
                <div className="text-sm font-semibold text-slate-600">Không tìm thấy đơn nào</div>
                <div className="text-xs text-slate-400">Thử thay đổi bộ lọc tìm kiếm hoặc làm mới trang.</div>
              </div>
            )}
          </div>

          {/* Decision Modal Portal (Phủ 100vw x 100vh) */}
          <Modal
            isOpen={decisionModal.isOpen}
            onClose={() => setDecisionModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className={`px-6 py-4 border-b flex items-center justify-between ${
              decisionModal.action === 'ĐÃ_DUYỆT' ? 'bg-emerald-50/70 border-emerald-100' : 'bg-rose-50/70 border-rose-100'
            }`}>
              <h3 className={`font-bold text-base flex items-center gap-2 ${
                decisionModal.action === 'ĐÃ_DUYỆT' ? 'text-emerald-900' : 'text-rose-900'
              }`}>
                {decisionModal.action === 'ĐÃ_DUYỆT' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                {decisionModal.action === 'ĐÃ_DUYỆT' ? 'Xác nhận Chấp thuận duyệt' : 'Xác nhận Từ chối đơn'}
              </h3>
              <button
                type="button"
                onClick={() => setDecisionModal(prev => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer transition p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmDecision} className="p-6 space-y-4 text-sm">
              {decisionModal.error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{decisionModal.error}</span>
                </div>
              )}

              {decisionModal.request && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div>
                    Mã đơn: <strong>#{decisionModal.request.id}</strong> • Loại: <strong>{decisionModal.request.type === 'XIN_NGHI' ? 'Nghỉ học' : 'Đổi ca'}</strong>
                  </div>
                  <div>
                    Học viên: <strong>{decisionModal.request.studentId}</strong> • Lớp: <strong>{decisionModal.request.classId}</strong>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lý do / Phản hồi gửi cho học viên <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={decisionModal.note}
                  onChange={e => setDecisionModal(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Nhập nội dung phản hồi chính thức từ Ban Quản trị..."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 focus:outline-emerald-600 focus:border-emerald-600"
                  required
                ></textarea>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDecisionModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition text-xs font-semibold cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={decisionModal.submitting}
                  className={`px-5 py-2 text-white rounded-lg text-xs font-semibold transition shadow-xs cursor-pointer flex items-center gap-1.5 ${
                    decisionModal.action === 'ĐÃ_DUYỆT'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {decisionModal.submitting ? 'Đang cập nhật...' : (decisionModal.action === 'ĐÃ_DUYỆT' ? 'Duyệt đơn' : 'Từ chối đơn')}
                </button>
              </div>
            </form>
          </Modal>
        </main>
      </div>
    </RoleGuard>
  );
}
