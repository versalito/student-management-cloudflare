'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { PaginationControls } from '@/components/common/PaginationControls';
import { AuditLog } from '@/types/audit';
import { History, Shield, User, Clock, Search } from 'lucide-react';

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Phân trang + tìm kiếm phía server: mỗi trang chỉ tải `pageSize` bản ghi.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(pageSize),
        });
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

        const res = await fetch(`/api/audit?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentPage, pageSize, debouncedSearch]);

  const totalPages = Math.ceil(total / pageSize) || 1;
  const paginatedLogs = logs;

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50">
      <Header 
        title="Nhật ký Hệ thống (Audit Trail)" 
        subtitle="Ghi nhận mọi thao tác phân công, sửa lịch, điểm danh, nộp học phí và duyệt đơn" 
      />

      <main className="p-6 max-w-7xl mx-auto w-full space-y-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo người dùng, nội dung, thao tác..."
              value={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-indigo-600"
            />
          </div>
          <div className="text-xs text-slate-500 font-medium w-full sm:w-auto text-left sm:text-right">
            Tổng cộng: <strong className="text-slate-800">{total}</strong> bản ghi
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Mã log</th>
                  <th className="px-4 py-3">Thời gian</th>
                  <th className="px-4 py-3">Người thực hiện</th>
                  <th className="px-4 py-3">Vai trò</th>
                  <th className="px-4 py-3">Hành động</th>
                  <th className="px-4 py-3">Tài nguyên</th>
                  <th className="px-4 py-3">Chi tiết diễn giải</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedLogs.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-4 py-3 font-mono font-bold text-slate-600">{l.id}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(l.timestamp).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {l.userName} ({l.userId})
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                        l.userRole === 'ADMIN'
                          ? 'bg-purple-100 text-purple-700'
                          : l.userRole === 'TEACHER'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {l.userRole}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{l.action}</td>
                    <td className="px-4 py-3 font-mono text-indigo-600">{l.targetResource}</td>
                    <td className="px-4 py-3 text-slate-700 font-medium max-w-md">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={total}
            onPageChange={setCurrentPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={[10, 25, 50, 100]}
            itemLabel="nhật ký"
          />
        </div>
      </main>
    </div>
  );
}
