import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * ESLint flat config.
 *
 * `eslint-config-next` 15 vẫn phát hành dạng eslintrc legacy nên phải đi qua
 * FlatCompat; `next lint` đã bị deprecate ở Next 15 và bị bỏ ở Next 16 nên
 * script lint gọi thẳng `eslint`.
 *
 * Quy ước: `error` là lỗi thật (hook sai chỗ, JSX hỏng, import sai) — CI chặn.
 * `warn` là nợ kỹ thuật đã biết (`any` ở tầng map DB, unused var trong test,
 * exhaustive-deps của effect tải dữ liệu); `npm run lint` in ra nhưng không
 * chặn build. Muốn siết dần thì nâng từng rule lên `error` khi đã dọn xong.
 */
const config = [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      'public/_headers',
      'node_modules/**',
      'next-env.d.ts',
      'gas-backend/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'warn',
      'prefer-const': 'warn',
    },
  },
];

export default config;
