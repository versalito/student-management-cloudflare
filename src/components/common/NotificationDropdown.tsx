'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { AppNotification } from '@/types/notification';
import { Bell, CheckCheck, Info, Calendar, CreditCard, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/EmptyState';

export const NotificationDropdown: React.FC = () => {
  const { currentUser } = useApp();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!currentUser) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    if (!currentUser?.id) return;
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_ALL_READ', userId: currentUser.id }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
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
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch (e) {
      console.error(e);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'SCHEDULE':
        return <Calendar size={15} className="text-primary" />;
      case 'PAYMENT':
        return <CreditCard size={15} className="text-success" />;
      case 'WARNING':
        return <AlertTriangle size={15} className="text-warning" />;
      default:
        return <Info size={15} className="text-info" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Thông báo"
        aria-label="Thông báo"
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-field transition cursor-pointer"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="min-w-[17px] h-[17px] bg-danger text-white text-[10px] font-bold rounded-full absolute -top-0.5 -right-0.5 ring-2 ring-card flex items-center justify-center px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed sm:absolute right-3 left-3 sm:left-auto sm:right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm sm:max-w-none bg-card rounded-card shadow-pop border border-line z-50 overflow-hidden animate-in-up">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground text-sm">Thông báo</span>
              {unreadCount > 0 && (
                <span className="bg-primary-soft text-primary-ink text-[11px] font-bold px-2 py-0.5 rounded-pill">
                  {unreadCount} mới
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[12px] text-primary hover:text-primary-hover font-semibold flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck size={14} /> Đọc tất cả
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {notifications.length > 0 ? (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markSingleRead(n.id)}
                  className={cn(
                    'p-3.5 hover:bg-muted/60 cursor-pointer transition flex items-start gap-3',
                    !n.isRead && 'bg-primary-soft/30'
                  )}
                >
                  <div className="p-2 rounded-field bg-muted shrink-0 mt-0.5">{getIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className={cn('text-[13px] text-foreground truncate', !n.isRead ? 'font-bold' : 'font-semibold')}>
                        {n.title}
                      </h4>
                      <span className="text-[10px] text-subtle-foreground shrink-0 tabular">
                        {n.createdAt.slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-1 leading-snug">{n.message}</p>
                    {n.link && (
                      <a
                        href={n.link}
                        className="inline-flex items-center gap-1 text-[11px] text-primary font-bold hover:underline mt-1.5"
                      >
                        Xem chi tiết <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
                </div>
              ))
            ) : (
              <EmptyState icon={<Bell size={22} />} title="Chưa có thông báo" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
