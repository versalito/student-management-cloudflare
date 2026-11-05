'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { AppNotification } from '@/types/notification';
import { Bell, CheckCheck, Info, Calendar, CreditCard, AlertTriangle, ExternalLink } from 'lucide-react';

export const NotificationDropdown: React.FC = () => {
  const { currentUser } = useApp();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userId = currentUser?.id;
  const userRole = currentUser?.role;

  // Polling 15s; deps là primitive (id/role) nên AppContext cấp lại object
  // currentUser (khi /api/users trả về) không tạo thêm request hay timer.
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${userId}&role=${userRole}`);
        const data = await res.json();
        if (!cancelled) setNotifications(data.notifications || []);
      } catch (e) {
        console.error(e);
      }
    };

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId, userRole]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!currentUser) {
    return null;
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markAllRead = async () => {
    if (!currentUser?.id) return;
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_ALL_READ', userId: currentUser.id }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (e) {
      console.error(e);
    }
  };

  const markSingleRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_READ', id }),
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch (e) {
      console.error(e);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'SCHEDULE':
        return <Calendar size={15} className="text-indigo-600" />;
      case 'PAYMENT':
        return <CreditCard size={15} className="text-emerald-600" />;
      case 'WARNING':
        return <AlertTriangle size={15} className="text-amber-600" />;
      default:
        return <Info size={15} className="text-blue-600" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Thông báo hệ thống"
        className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition relative"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] bg-rose-500 text-white text-[10px] font-bold rounded-full absolute -top-1 -right-1 ring-2 ring-white flex items-center justify-center px-1 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed sm:absolute right-3 left-3 sm:left-auto sm:right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm sm:max-w-none bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 text-sm">Thông báo</span>
              {unreadCount > 0 && (
                <span className="bg-indigo-50 text-indigo-700 text-[11px] font-bold px-2 py-0.2 rounded-full border border-indigo-100">
                  {unreadCount} mới
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <CheckCheck size={14} /> Đọc tất cả
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {notifications.length > 0 ? (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => markSingleRead(n.id)}
                  className={`p-3.5 hover:bg-slate-50/80 cursor-pointer transition flex items-start gap-3 text-xs ${
                    !n.isRead ? 'bg-indigo-50/30' : ''
                  }`}
                >
                  <div className="p-2 rounded-xl bg-slate-100 shrink-0 mt-0.5">
                    {getIcon(n.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className={`text-slate-800 truncate ${!n.isRead ? 'font-bold' : 'font-semibold'}`}>
                        {n.title}
                      </h4>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {n.createdAt.slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-slate-600 text-[11px] mt-1 leading-relaxed">
                      {n.message}
                    </p>
                    {n.link && (
                      <a
                        href={n.link}
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 font-bold hover:underline mt-1.5"
                      >
                        Xem chi tiết <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  {!n.isRead && (
                    <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0 mt-2"></span>
                  )}
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Không có thông báo nào.
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-100 text-center text-[11px] text-slate-500">
            Hệ thống Quản lý Luyện thi
          </div>
        </div>
      )}
    </div>
  );
};
