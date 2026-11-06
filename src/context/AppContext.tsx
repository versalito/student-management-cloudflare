'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User } from '@/types/auth';

interface AppContextType {
  currentUser: User | null;
  availableUsers: User[];
  setAvailableUsers: (users: User[]) => void;
  isLoading: boolean;
  isReady: boolean;
  refreshUsers: () => Promise<void>;
  login: (user: User) => void;
  logout: () => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Trạng thái phiên của client.
 *
 * Nguồn duy nhất là cookie phiên HttpOnly, đọc qua `/api/auth/me` ở mỗi lần tải
 * trang. Không còn bản sao trong `localStorage`: bản sao cũ khiến người dùng
 * thấy sidebar/nút của vai trò trước đó (hoặc của tài khoản đã bị khoá) trong
 * lúc chờ server, và là chỗ để sửa tay nâng quyền trên trình duyệt.
 *
 * Trong lúc chờ, `isReady` = false và `RoleGuard` hiển thị spinner.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const currentUserRef = useRef<User | null>(null);

  const applyUser = (user: User | null) => {
    currentUserRef.current = user;
    setCurrentUserState(user);
  };

  // Hỏi server xem cookie phiên còn hiệu lực không; đây là lần duy nhất xác định user.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Dọn tàn dư của cơ chế cũ (client tự lưu user) nếu máy đã từng đăng nhập.
      localStorage.removeItem('active_user');
      localStorage.removeItem('active_user_id');
      localStorage.removeItem('auth_token');
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          applyUser(data.user || null);
        } else {
          applyUser(null);
        }
      } catch (err) {
        console.error('Không tải được phiên đăng nhập:', err);
        applyUser(null);
      } finally {
        if (!cancelled) {
          setIsReady(true);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchUsers = async () => {
    // GET /api/users chỉ dành cho ADMIN; vai trò khác gọi sẽ nhận 403.
    if (currentUserRef.current && currentUserRef.current.role !== 'ADMIN') {
      setAvailableUsers([]);
      return;
    }
    try {
      const res = await fetch('/api/users', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  useEffect(() => {
    if (isReady) fetchUsers();
     
  }, [isReady, currentUser?.role]);

  /** Đăng nhập do server cấp cookie; đây chỉ đồng bộ state để render. */
  const login = (user: User) => {
    applyUser(user);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/me', { method: 'DELETE', credentials: 'same-origin' });
    } catch (err) {
      console.error('Lỗi khi đăng xuất:', err);
    }
    applyUser(null);
    setAvailableUsers([]);
    if (typeof window !== 'undefined') window.location.href = '/login';
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        availableUsers,
        setAvailableUsers,
        isLoading,
        isReady,
        refreshUsers: fetchUsers,
        login,
        logout,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp phải dùng bên trong <AppProvider>');
  return ctx;
}
