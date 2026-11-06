'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Menu, LogOut, Compass } from 'lucide-react';
import { NotificationDropdown } from './NotificationDropdown';
import { Avatar } from '@/components/ui/Avatar';
import { NAV_GROUPS, findActiveNav } from './navConfig';

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

/**
 * Thanh tiêu đề trên cùng của mỗi trang.
 * Tiêu đề trang tự lấy từ menu điều hướng khi không truyền vào.
 */
export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const pathname = usePathname();
  const { currentUser, logout, isMobileMenuOpen, setIsMobileMenuOpen } = useApp();

  const activeNav = currentUser ? findActiveNav(NAV_GROUPS[currentUser.role], pathname) : undefined;
  const pageTitle = title || activeNav?.label || 'Trang';

  return (
    <header className="h-16 bg-background/85 backdrop-blur border-b border-line px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 -ml-1 md:hidden text-muted-foreground hover:text-foreground hover:bg-muted rounded-field transition shrink-0 cursor-pointer"
          aria-label="Mở menu điều hướng"
        >
          <Menu size={20} />
        </button>

        <Link href="/" className="flex items-center gap-2 md:hidden shrink-0" aria-label="Trang chủ">
          <span className="w-8 h-8 rounded-field bg-primary text-white flex items-center justify-center">
            <Compass size={17} />
          </span>
        </Link>

        <div className="min-w-0">
          <h1 className="text-[15px] sm:text-base font-bold text-foreground leading-tight truncate">
            {pageTitle}
          </h1>
          {subtitle && <p className="hidden sm:block text-[12px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <NotificationDropdown />

        {currentUser && (
          <div className="hidden lg:flex items-center gap-2 pl-1">
            <Avatar name={currentUser.name} src={currentUser.avatar} size={32} />
            <span className="text-[13px] font-semibold text-foreground max-w-[140px] truncate">
              {currentUser.name}
            </span>
          </div>
        )}

        <button
          onClick={() => void logout()}
          title="Đăng xuất"
          aria-label="Đăng xuất"
          className="p-2 text-muted-foreground hover:text-danger hover:bg-danger-soft rounded-field transition cursor-pointer"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
};

export default Header;
