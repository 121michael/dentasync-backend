export function dashboardQuery({ branchId, date, extra = {} } = {}) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (branchId && branchId !== "all") params.set("branchId", String(branchId));
  Object.entries(extra).forEach(([key, value]) => {
    if (value != null && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export function dashboardHref(path, scope) {
  const query = dashboardQuery(scope);
  return query ? `${path}?${query}` : path;
}

export function floorMetricHref(metric, scope) {
  return dashboardHref("/admin/roster", { ...scope, extra: { metric } });
}
