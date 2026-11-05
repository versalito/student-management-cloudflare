#!/usr/bin/env node
/**
 * Rà các buổi học (schedule_slots) có ngày rơi vào thứ KHÔNG nằm trong
 * class_sections.schedule_days của ca tương ứng.
 *
 * Mặc định chỉ báo cáo (dry-run). Thêm --apply để xoá, kèm file backup JSON
 * chứa nguyên văn các dòng bị xoá (khôi phục lại được bằng tay).
 *
 *   node --import tsx scripts/audit-slot-weekdays.ts
 *   node --import tsx scripts/audit-slot-weekdays.ts --apply --backup /tmp/slot-weekday-backup.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { dateToDayOfWeek } from '../src/utils/date';

const DAY_LABEL: Record<number, string> = {
  2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5', 6: 'T6', 7: 'T7', 8: 'CN',
};

function loadEnv() {
  for (const file of ['.env.local', '.dev.vars']) {
    const envPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const apply = process.argv.includes('--apply');
const backupArgIndex = process.argv.indexOf('--backup');
const backupPath =
  backupArgIndex > -1 && process.argv[backupArgIndex + 1]
    ? process.argv[backupArgIndex + 1]
    : `/tmp/slot-weekday-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (.env.local hoặc .dev.vars)');
  process.exit(1);
}

const restHeaders = { apikey: key, Authorization: `Bearer ${key}` };

async function restGet<T>(table: string, select: string, range?: string): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/${table}?select=${select}`, {
    headers: { ...restHeaders, ...(range ? { Range: range } : {}) },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

type Slot = { id: string; class_id: string; section_id: string | null; date: string; start_time?: string };
type Section = { id: string; class_id: string; name?: string; schedule_days: number[] | null };

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await restGet<T>(table, select, `${from}-${from + pageSize - 1}`);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

async function main() {
  const [sections, slots] = await Promise.all([
    fetchAll<Section>('class_sections', 'id,class_id,name,schedule_days'),
    fetchAll<Slot>('schedule_slots', 'id,class_id,section_id,date,start_time'),
  ]);

  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  const mismatches: { slot: Slot; section: Section; weekday: number }[] = [];
  let skippedNoSection = 0;
  let skippedNoDays = 0;

  for (const slot of slots) {
    if (!slot.section_id) {
      skippedNoSection++;
      continue;
    }
    const section = sectionMap.get(slot.section_id);
    if (!section) continue;
    const days = (section.schedule_days || []).map(Number).filter((n) => n >= 2 && n <= 8);
    if (days.length === 0) {
      skippedNoDays++;
      continue;
    }
    const weekday = dateToDayOfWeek(slot.date);
    if (weekday === null || !days.includes(weekday)) {
      mismatches.push({ slot, section, weekday: weekday ?? -1 });
    }
  }

  console.log(`Tổng: ${slots.length} buổi, ${sections.length} ca.`);
  console.log(`Bỏ qua: ${skippedNoSection} buổi không gắn ca, ${skippedNoDays} buổi thuộc ca chưa đặt thứ.`);
  console.log(`Lệch thứ: ${mismatches.length} buổi\n`);

  const bySection = new Map<string, typeof mismatches>();
  for (const m of mismatches) {
    const list = bySection.get(m.section.id) || [];
    list.push(m);
    bySection.set(m.section.id, list);
  }

  for (const [sectionId, list] of bySection) {
    const section = sectionMap.get(sectionId)!;
    const days = (section.schedule_days || []).map((d) => DAY_LABEL[d] || d).join(',');
    console.log(`  ca ${sectionId} (lớp ${section.class_id}, thứ ${days}) — ${list.length} buổi:`);
    for (const { slot, weekday } of list.sort((a, b) => a.slot.date.localeCompare(b.slot.date))) {
      console.log(`    ${slot.id}  ${slot.date} (${DAY_LABEL[weekday] || weekday})  ${slot.start_time || ''}`);
    }
  }

  if (mismatches.length === 0) {
    console.log('Không có gì để sửa.');
    process.exit(0);
  }

  if (!apply) {
    console.log('\nDry-run. Thêm --apply để xoá (có backup JSON).');
    process.exit(0);
  }

  fs.writeFileSync(backupPath, JSON.stringify(mismatches.map((m) => m.slot), null, 2));
  console.log(`\nBackup ${mismatches.length} dòng -> ${backupPath}`);

  const ids = mismatches.map((m) => m.slot.id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch(
      `${url}/rest/v1/schedule_slots?id=in.(${batch.map((id) => `"${id}"`).join(',')})`,
      { method: 'DELETE', headers: { ...restHeaders, Prefer: 'return=minimal' } },
    );
    if (!res.ok) {
      console.error(`Xoá thất bại ở batch ${i}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
  }
  console.log(`Đã xoá ${ids.length} buổi lệch thứ. Khôi phục: đọc file backup ở trên.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
