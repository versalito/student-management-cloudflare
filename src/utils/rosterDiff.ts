/**
 * So sánh danh sách ghi danh mong muốn với dữ liệu hiện có để chỉ ghi phần chênh lệch.
 *
 * Vì sao không xoá-rồi-chèn: hai thao tác ghi danh xen nhau (đổi ca, enroll) đều
 * gửi lên mảng `studentIds` chụp từ client. Nếu mỗi lần đều xoá sạch rồi chèn lại
 * thì thao tác sau sẽ nuốt mất ghi danh vừa tạo ở thao tác trước.
 */
export function diffRoster(
  desiredIds: readonly string[],
  currentIds: readonly string[]
): { toAdd: string[]; toRemove: string[] } {
  const desired = new Set(desiredIds);
  const current = new Set(currentIds);
  return {
    toAdd: Array.from(desired).filter((id) => !current.has(id)),
    toRemove: Array.from(current).filter((id) => !desired.has(id)),
  };
}
