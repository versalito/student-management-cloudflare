import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually if not in process.env (same pattern as scripts/seed-gas.ts)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

/**
 * Đối soát hồ sơ students/teachers còn thiếu (idempotent).
 * Usage: npm run db:reconcile
 */

import { repo } from '../src/repositories';
import { ProfileReconcileService } from '../src/services/ProfileReconcileService';

async function main() {
  const service = new ProfileReconcileService(repo);
  const { studentsCreated, teachersCreated } = await service.reconcile();

  console.log(`✅ Đối soát xong.`);
  console.log(`   - Hồ sơ học viên tạo mới: ${studentsCreated.length}`);
  if (studentsCreated.length) console.log(`     ${studentsCreated.join(', ')}`);
  console.log(`   - Hồ sơ giáo viên tạo mới: ${teachersCreated.length}`);
  if (teachersCreated.length) console.log(`     ${teachersCreated.join(', ')}`);
}

main().catch(err => {
  console.error('❌ Đối soát thất bại:', err);
  process.exit(1);
});
