export function matchesNotificationFocus(item, focus, keys = ["id"]) {
  if (!focus || !item) return false;
  const needle = String(focus).trim().toLowerCase();
  if (!needle) return false;
  const aliases = [needle, needle.replace(/^#/, "")];
  return keys.some((key) => {
    const value = item[key];
    if (value == null || String(value).trim() === "") return false;
    const haystack = String(value).trim().toLowerCase();
    return aliases.includes(haystack);
  });
}
