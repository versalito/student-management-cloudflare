import React from 'react';
import { cn } from '@/lib/cn';

export const Avatar: React.FC<{
  name?: string;
  src?: string;
  size?: number;
  className?: string;
}> = ({ name, src, size = 40, className }) => {
  const initial = (name || 'U').trim().charAt(0).toUpperCase();
  return src ? (
     
    <img
      src={src}
      alt={name || 'Ảnh đại diện'}
      style={{ width: size, height: size }}
      className={cn('rounded-full object-cover border border-line shrink-0', className)}
    />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn(
        'rounded-full bg-primary-soft text-primary-ink font-bold flex items-center justify-center shrink-0',
        className
      )}
    >
      {initial}
    </span>
  );
};
