'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { Card, CardHeader } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { SegmentedControl, TabItem } from '@/components/ui/Tabs';
import {
  ArrowRight,
  Shield,
  QrCode,
  CalendarDays,
  FileText,
  CreditCard,
  CheckCircle2,
} from 'lucide-react';

function AdminGuidesContent() {
  const [activeTab, setActiveTab] = useState<'admin' | 'teacher' | 'student'>('admin');

  const roleTabs: TabItem<'admin' | 'teacher' | 'student'>[] = [
    { value: 'admin', label: 'Quản trị viên & Học phí' },
    { value: 'teacher', label: 'Dành cho giáo viên' },
    { value: 'student', label: 'Dành cho học sinh' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <Header
        title="Hướng dẫn sử dụng hệ thống"
        subtitle="Tài liệu vận hành, quy trình nghiệp vụ và đối soát học phí"
      />

      <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
        {/* Thanh chọn vai trò & Lối tắt */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <SegmentedControl
            items={roleTabs}
            value={activeTab}
            onChange={(v) => setActiveTab(v)}
          />

          <LinkButton href="/admin/tuition" variant="secondary" size="sm" icon={<ArrowRight size={15} />} className="self-end sm:self-auto">
            Quản lý học phí
          </LinkButton>
        </div>

        {/* TAB 1: QUẢN TRỊ VIÊN & CỔNG THANH TOÁN */}
        {activeTab === 'admin' && (
          <div className="space-y-5">
            <Card className="bg-primary text-white border-0 shadow-primary space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-white/15 text-[12px] font-semibold text-white/90">
                <CreditCard size={14} />
                <span>Đối soát thủ công</span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold">
                Học sinh chuyển khoản bằng VietQR, quản trị xác nhận
              </h2>
              <p className="text-[13px] text-white/80 leading-relaxed max-w-3xl">
                Mã QR động đã điền sẵn số tiền và nội dung chuyển khoản. Sau khi nhận được tiền trong tài khoản
                ngân hàng, quản trị mở <strong className="font-semibold text-white">Quản lý học phí</strong>,
                bấm <strong className="font-semibold text-white">Thu tiền</strong> và ghi nhận số tiền thực nhận.
                Hệ thống không tự động gạch nợ từ bất kỳ cổng thanh toán bên thứ ba nào.
              </p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="space-y-3">
                <div className="w-8 h-8 rounded-pill bg-primary-soft text-primary-ink flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <h3 className="text-[15px] font-bold text-foreground">Khai báo tài khoản thụ hưởng</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Tại mục <Link href="/admin/tuition" className="text-primary font-semibold hover:underline">Quản lý học phí</Link>, mở cấu hình ngân hàng để nhập:
                </p>
                <ul className="text-[13px] text-muted-foreground space-y-1 list-disc pl-4">
                  <li>Tên ngân hàng thụ hưởng (MB, VCB, TCB...)</li>
                  <li>Số tài khoản ngân hàng</li>
                  <li>Tên chủ tài khoản (viết hoa không dấu)</li>
                </ul>
              </Card>

              <Card className="space-y-3">
                <div className="w-8 h-8 rounded-pill bg-primary-soft text-primary-ink flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <h3 className="text-[15px] font-bold text-foreground">Học sinh chuyển khoản</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Học sinh mở <strong className="text-foreground">Học phí</strong>, chọn hoá đơn cần đóng và quét mã VietQR.
                  Nội dung chuyển khoản mang sẵn mã nhận diện:
                </p>
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex items-center justify-between p-2 rounded-field bg-muted">
                    <span className="text-muted-foreground">Theo mã hoá đơn:</span>
                    <span className="font-mono font-bold text-primary-ink">TUI0001</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-field bg-muted">
                    <span className="text-muted-foreground">Theo mã học sinh:</span>
                    <span className="font-mono font-bold text-primary-ink">ST001</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Học sinh quét QR rồi chuyển khoản; hoá đơn <strong className="text-foreground">không</strong> tự
                    đánh dấu đã nộp — quản trị đối soát sao kê rồi xác nhận ở bước sau.
                  </p>
                </div>
              </Card>

              <Card className="space-y-3">
                <div className="w-8 h-8 rounded-pill bg-primary-soft text-primary-ink flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <h3 className="text-[15px] font-bold text-foreground">Quản trị xác nhận</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Đối chiếu sao kê ngân hàng rồi mở ô <strong className="text-foreground">Thu tiền</strong> của hoá đơn:
                </p>
                <ul className="text-[13px] text-muted-foreground space-y-1 list-disc pl-4">
                  <li>Chọn cách thu và ngày thu</li>
                  <li>Nhập <strong className="text-foreground">số tiền thực nhận</strong> (mặc định bằng số còn nợ)</li>
                  <li>Nhập ít hơn số còn nợ thì hoá đơn được ghi nhận thanh toán một phần và vẫn ở trạng thái <strong className="text-foreground">Còn nợ</strong></li>
                </ul>
              </Card>
            </div>

            <Card className="space-y-3">
              <CardHeader
                title="Đối soát và nhật ký"
                subtitle="Mọi lần xác nhận đều ghi nhật ký để tra cứu về sau"
                icon={<Shield size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Nhật ký thao tác tại <Link href="/admin/audit" className="text-primary font-semibold hover:underline">Nhật ký hệ thống</Link> ghi lại người xác nhận, số tiền và lý do/ghi chú.</li>
                <li>Số tiền đã nộp, còn nợ và mã giao dịch thủ công (<span className="font-mono">MANUAL-...</span>) hiển thị ngay trên bảng học phí.</li>
                <li>Hoá đơn đã có thanh toán một phần vẫn cho phép thu tiếp cho đến khi hết nợ.</li>
              </ul>
            </Card>
          </div>
        )}

        {/* TAB 2: DÀNH CHO GIÁO VIÊN */}
        {activeTab === 'teacher' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="space-y-3">
              <CardHeader
                title="1. Điểm danh và theo dõi lớp"
                icon={<CheckCircle2 size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Truy cập mục <strong>Điểm danh</strong> hoặc chọn ca dạy trong ngày tại màn hình chính.</li>
                <li>Chọn trạng thái cho từng học sinh: <strong>Có mặt</strong>, <strong>Đi muộn</strong>, <strong>Vắng có phép</strong> hoặc <strong>Vắng không phép</strong>.</li>
                <li>Hệ thống lưu tức thì và đồng bộ sang báo cáo học tập của học sinh và phụ huynh.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="2. Quản lý lịch dạy"
                icon={<CalendarDays size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Xem lịch dạy cá nhân theo tuần hoặc theo tháng.</li>
                <li>Chấm công theo ca trước khi vào lớp để hệ thống ghi nhận thù lao.</li>
                <li>Khi có việc bận, báo trước cho quản trị viên để sắp xếp dạy bù.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="3. Thù lao và thống kê tiết dạy"
                icon={<CreditCard size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Thù lao được tính tự động dựa trên số tiết đã điểm danh hoàn tất trong tháng.</li>
                <li>Đơn giá mỗi giờ dạy áp dụng theo mức thỏa thuận được lưu trong hồ sơ giáo viên.</li>
                <li>Bảng kê chi tiết sẵn sàng để đối soát vào cuối mỗi kỳ thanh toán.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="4. Đơn xin nghỉ từ học sinh"
                icon={<FileText size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Học sinh gửi đơn xin nghỉ qua cổng cá nhân kèm lý do và ngày nghỉ.</li>
                <li>Giáo viên phụ trách xem đơn và phản hồi duyệt hoặc từ chối kèm ghi chú.</li>
                <li>Các buổi nghỉ được duyệt sẽ được đánh dấu vắng có phép tự động trong sổ điểm danh.</li>
              </ul>
            </Card>
          </div>
        )}

        {/* TAB 3: DÀNH CHO HỌC SINH */}
        {activeTab === 'student' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="space-y-3">
              <CardHeader
                title="1. Tra cứu lịch học và ca học"
                icon={<CalendarDays size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Xem toàn bộ lịch học trong tuần ngay tại bảng điều khiển cá nhân.</li>
                <li>Nắm rõ thông tin phòng học, thời gian bắt đầu và giáo viên phụ trách.</li>
                <li>Nhận thông báo khi lớp có thay đổi lịch hoặc có buổi học bù.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="2. Điểm danh và chuyên cần"
                icon={<CheckCircle2 size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Theo dõi tỷ lệ chuyên cần và số buổi đã tham gia trong từng khóa học.</li>
                <li>Xác nhận điểm danh theo hướng dẫn của giáo viên trong giờ học.</li>
                <li>Xem lại lịch sử điểm danh từng ngày để kịp thời phản hồi nếu có nhầm lẫn.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="3. Nộp học phí qua mã QR"
                icon={<QrCode size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Vào mục <strong>Học phí</strong> để xem các hóa đơn cần thanh toán.</li>
                <li>Mở mã QR VietQR và quét bằng ứng dụng ngân hàng bất kỳ.</li>
                <li>Không cần sửa nội dung chuyển khoản vì mã QR đã gắn sẵn mã nhận diện tự động.</li>
                <li>Hoá đơn không tự đánh dấu đã nộp: quản trị đối soát sao kê rồi xác nhận, sau đó trạng thái chuyển sang <strong>Đã nộp</strong>.</li>
                <li>Nếu đổi ý trước khi chuyển tiền, mở mã QR và bấm <strong>Huỷ thanh toán</strong> để gỡ hoá đơn khỏi công nợ.</li>
              </ul>
            </Card>

            <Card className="space-y-3">
              <CardHeader
                title="4. Gửi đơn xin nghỉ học"
                icon={<FileText size={18} />}
              />
              <ul className="text-[13px] text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                <li>Khi bận việc đột xuất, gửi đơn xin nghỉ trực tiếp trên cổng học sinh.</li>
                <li>Chọn ngày nghỉ, ca học và nhập lý do ngắn gọn.</li>
                <li>Nhận kết quả phản hồi của giáo viên ngay trên màn hình thông báo.</li>
                <li>Muốn học ca khác thì vào mục <strong>Lớp của tôi</strong> để đổi ca ngay, không cần chờ duyệt.</li>
              </ul>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AdminGuidesPage() {
  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Đang tải hướng dẫn...</div>}>
        <AdminGuidesContent />
      </Suspense>
    </RoleGuard>
  );
}
