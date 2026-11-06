/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Cache-Control phải khai báo tường minh cho mọi response do Next render.
   *
   * Bối cảnh: `next start` mặc định cache GET theo `revalidate: 1 year`, nên
   * `/api/*` trả snapshot cũ sau khi ghi, và HTML của portal đăng nhập có thể bị
   * dùng lại giữa các phiên. Ở đây:
   *   - HTML + API: `private, no-store` — dữ liệu người dùng, không cache ở bất kỳ đâu.
   *   - `/_next/static/*`: tên file đã băm nên cache vĩnh viễn (Workers còn khai
   *     báo lại trong public/_headers cho lớp static asset).
   */
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Khớp mọi route trừ asset đã băm ở trên.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },

  webpack: (config, { dev }) => {
    if (!dev) {
      // Tắt filesystem cache của Webpack trong production build
      // để tránh lỗi corrupted cache (PackFileCacheStrategy TypeError) trên CI/Cloudflare Pages
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
