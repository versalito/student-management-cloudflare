#!/usr/bin/env node
/**
 * Đối soát buổi học quá khứ chưa được chốt.
 *
 * Bối cảnh (đo trên production 2026-11-07): 153 buổi đã qua, 145 buổi còn
 * `Đã lên lịch`, và **0** trong số đó có bản ghi điểm danh. Vì lương giáo viên chỉ
 * tính buổi `Đã hoàn thành`, để nguyên thì bảng lương tháng vẫn bằng 0.
 *
 * Script này KHÔNG tự chốt bừa. Nó phân loại từng buổi và chỉ chốt khi có bằng
 * chứng đủ mạnh:
 *   A. có bản ghi điểm danh thật            → chốt `Đã hoàn thành` (an toàn)
 *   B. giáo viên đã check-in/checkout       → chốt `Đã hoàn thành`
 *   C. không có gì cả                       → chỉ báo cáo, cần người quyết định
 *
 * Cách dùng:
 *   DATA_SOURCE=supabase node scripts/reconcile-slots.mjs              # báo cáo
 *   DATA_SOURCE=supabase node scripts/reconcile-slots.mjs --apply      # chốt A+B
 *   DATA_SOURCE=supabase node scripts/reconcile-slots.mjs --apply --include-c
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes('--apply');
const includeC = process.argv.includes('--include-c');

function headers(extra = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong môi trường');
  }
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function todayVn() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(new Date());
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: headers(init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const today = todayVn();
  console.log(`Hôm nay (VN): ${today} | chế độ: ${apply ? 'APPLY' : 'BÁO CÁO'}`);

  const past = await rest(
    `schedule_slots?select=id,date,status,teacher_id,class_id,checkin_time,checkout_time` +
      `&date=lt.${today}&status=eq.${encodeURIComponent('Đã lên lịch')}&order=date.asc`,
  );

  const slotIds = past.map((s) => s.id);
  const attendance = slotIds.length
    ? await rest(`attendance_records?select=schedule_slot_id,status&schedule_slot_id=in.(${slotIds.join(',')})`)
    : [];

  const attendedSlots = new Set(
    attendance.filter((a) => String(a.status) !== 'Chưa điểm danh').map((a) => a.schedule_slot_id),
  );

  const catA = [];
  const catB = [];
  const catC = [];
  for (const slot of past) {
    if (attendedSlots.has(slot.id)) catA.push(slot);
    else if (slot.checkin_time || slot.checkout_time) catB.push(slot);
    else catC.push(slot);
  }

  console.log(`\nTổng buổi quá khứ chưa chốt: ${past.length}`);
  console.log(`  A. có sổ điểm danh thật        : ${catA.length}`);
  console.log(`  B. có check-in/check-out       : ${catB.length}`);
  console.log(`  C. không có bằng chứng nào     : ${catC.length}`);

  if (catC.length) {
    const byTeacher = {};
    for (const s of catC) byTeacher[s.teacher_id] = (byTeacher[s.teacher_id] || 0) + 1;
    console.log('\n  C theo giáo viên:', JSON.stringify(byTeacher));
    console.log('  (C nên được xử lý thủ công: dạy bù, huỷ, hay chốt?)');
  }

  const toSettle = includeC ? [...catA, ...catB, ...catC] : [...catA, ...catB];

  if (!apply) {
    console.log(`\nSẽ chốt ${toSettle.length} buổi nếu chạy với --apply.`);
    return;
  }
  if (toSettle.length === 0) return;

  // Chốt theo lô, chia nhỏ để không tạo URL quá dài.
  const CHUNK = 100;
  let changed = 0;
  for (let i = 0; i < toSettle.length; i += CHUNK) {
    const ids = toSettle.slice(i, i + CHUNK).map((s) => s.id);
    await rest(`schedule_slots?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'Đã hoàn thành' }),
    });
    changed += ids.length;
    console.log(`  chốt ${changed}/${toSettle.length}`);
  }

  // Ghi audit để tra cứu về sau, dùng cùng định dạng với SlotSettlementService.
  const entries = toSettle.map((s) => ({
    id: `AUD_RECON_${s.id}_${Date.now()}`,
    user_id: 'SYSTEM',
    user_name: 'Hệ thống (đối soát)',
    user_role: 'ADMIN',
    action: 'UPDATE',
    target_resource: 'SCHEDULE',
    target_id: s.id,
    details: `Đối soát chốt buổi ${s.id} (${s.date}) sang "Đã hoàn thành".`,
  }));
  await rest('audit_logs', { method: 'POST', body: JSON.stringify(entries) });

  console.log(`\nĐã chốt ${changed} buổi và ghi ${entries.length} dòng audit.`);
  console.log('Bảng lương sẽ tự cập nhật ở lần gọi GET /api/payroll?teacherId=...&month=...');
}

main().catch((err) => {
  console.error('LỖI:', err.message);
  process.exit(1);
});
