const API_BASE = import.meta.env.VITE_API_URL || "/api";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function accessToken() {
  return localStorage.getItem("amethyst_access_token");
}

async function request(path, { method = "GET", body, headers = {}, authenticated = true } = {}) {
  const requestHeaders = { ...headers };
  const token = accessToken();

  if (authenticated && token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: requestHeaders,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(data?.message || "Something went wrong. Please try again.", response.status, data);
  }

  return data;
}

async function download(path, filename) {
  const token = accessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.message || "Unable to download the document.", response.status, data);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  login: (body) => request("/auth/login", { method: "POST", body, authenticated: false }),
  register: (body) => request("/auth/register", { method: "POST", body, authenticated: false }),
  resendOtp: (body) => request("/auth/send-otp", { method: "POST", body, authenticated: false }),
  verifyOtp: (body) => request("/auth/verify-otp", { method: "POST", body, authenticated: false }),
  requestPasswordReset: (body) =>
    request("/auth/forgot-password", { method: "POST", body, authenticated: false }),
  resetPassword: (body) =>
    request("/auth/reset-password", { method: "POST", body, authenticated: false }),
  getCurrentUser: () => request("/auth/me"),
  getDashboard: () => request("/patient/dashboard"),
  getCatalog: () => request("/patient/catalog"),
  getAppointments: () => request("/patient/appointments"),
  createAppointment: (body) => request("/patient/appointments", { method: "POST", body }),
  cancelAppointment: (appointmentId) =>
    request(`/patient/appointments/${appointmentId}/cancel`, { method: "PATCH" }),
  getQueue: () => request("/patient/queue"),
  checkIn: (appointmentId) =>
    request("/patient/queue/check-in", { method: "POST", body: { appointmentId } }),
  updateQueueNotifications: (notifyWhenNear) =>
    request("/patient/queue/notifications", {
      method: "PATCH",
      body: { notifyWhenNear },
    }),
  getRecords: (params = {}) => {
    const search = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value)
    );
    return request(`/patient/records${search.size ? `?${search}` : ""}`);
  },
  downloadRecordDocument: (recordId, document) =>
    download(
      `/patient/records/${recordId}/documents/${document.id}/download`,
      document.name
    ),
  downloadPortalDocument: (document) =>
    download(`/patient/documents/${document.id}/download`, document.name),
  uploadHmoAuthorization: (file) => {
    const data = new FormData();
    data.append("file", file);
    return request("/patient/uploads/hmo-authorization", { method: "POST", body: data });
  },
  getProfile: () => request("/patient/profile"),
  updateProfile: (body) => request("/patient/profile", { method: "PUT", body }),
  updatePreferences: (body) => request("/patient/preferences", { method: "PUT", body }),
  getSecurity: () => request("/patient/security"),
  updatePassword: (body) => request("/patient/security/password", { method: "PUT", body }),
  getNotifications: () => request("/patient/notifications"),
  markNotificationRead: (notificationId) =>
    request(`/patient/notifications/${notificationId}/read`, { method: "PATCH" }),
  getStaffDashboard: () => request("/staff/dashboard"),
  getStaffCheckIns: () => request("/staff/check-ins"),
  getStaffQueue: () => request("/staff/queue"),
  updateStaffQueue: (queueEntryId, body) =>
    request(`/staff/queue/${queueEntryId}`, { method: "PATCH", body }),
  getStaffAppointments: () => request("/staff/appointments"),
  updateStaffAppointment: (appointmentId, body) =>
    request(`/staff/appointments/${appointmentId}`, { method: "PATCH", body }),
  getStaffDentistAvailability: () => request("/staff/dentist-availability"),
  getStaffPatients: (search = "") =>
    request(`/staff/patients${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createStaffPatient: (body) => request("/staff/patients", { method: "POST", body }),
  getStaffPatient: (patientId) => request(`/staff/patients/${patientId}`),
  getStaffNotifications: () => request("/staff/notifications"),
  markStaffNotificationRead: (notificationId) =>
    request(`/staff/notifications/${notificationId}/read`, { method: "PATCH" }),
  markAllStaffNotificationsRead: () =>
    request("/staff/notifications/read-all", { method: "PATCH" }),
  getStaffProfile: () => request("/staff/profile"),
  updateStaffProfile: (body) => request("/staff/profile", { method: "PUT", body }),
  downloadStaffExport: (report) =>
    download(`/staff/export/${encodeURIComponent(report)}`, `${report}-log.csv`),
  getAdminDashboard: () => request("/admin/dashboard"),
  getAdminPatients: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value || value === 0));
    return request(`/admin/patients${search.size ? `?${search}` : ""}`);
  },
  createAdminPatient: (body) => request("/admin/patients", { method: "POST", body }),
  updateAdminPatient: (id, body) => request(`/admin/patients/${id}`, { method: "PATCH", body }),
  getAdminPatient: (id) => request(`/admin/patients/${id}`),
  getAdminStaff: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value || value === 0));
    return request(`/admin/staff${search.size ? `?${search}` : ""}`);
  },
  createAdminStaff: (body) => request("/admin/staff", { method: "POST", body }),
  updateAdminStaff: (id, body) => request(`/admin/staff/${id}`, { method: "PATCH", body }),
  getAdminDentists: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value || value === 0));
    return request(`/admin/dentists${search.size ? `?${search}` : ""}`);
  },
  createAdminDentist: (body) => request("/admin/dentists", { method: "POST", body }),
  updateAdminDentist: (id, body) => request(`/admin/dentists/${id}`, { method: "PATCH", body }),
  getAdminAccounts: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value || value === 0));
    return request(`/admin/accounts${search.size ? `?${search}` : ""}`);
  },
  updateAdminAccountStatus: (id, body) => request(`/admin/accounts/${id}/status`, { method: "PATCH", body }),
  deleteAdminAccount: (id) => request(`/admin/accounts/${id}`, { method: "DELETE" }),
  getAdminAppointments: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value || value === 0));
    return request(`/admin/appointments${search.size ? `?${search}` : ""}`);
  },
  updateAdminAppointment: (id, body) => request(`/admin/appointments/${id}`, { method: "PATCH", body }),
  getAdminAnalytics: (range = "month") => request(`/admin/analytics?range=${encodeURIComponent(range)}`),
  getAdminSettings: () => request("/admin/settings"),
  updateAdminSettings: (body) => request("/admin/settings", { method: "PUT", body }),
  getAdminSecurity: () => request("/admin/security"),
  getAdminSystemHealth: () => request("/admin/system-health"),
  getAdminSync: () => request("/admin/sync"),
  runAdminSync: () => request("/admin/sync", { method: "POST" }),
  getAdminNotifications: () => request("/admin/notifications"),
  markAdminNotificationRead: (id) => request(`/admin/notifications/${id}/read`, { method: "PATCH" }),
  markAllAdminNotificationsRead: () => request("/admin/notifications/read-all", { method: "PATCH" }),
  getAdminProfile: () => request("/admin/profile"),
  updateAdminProfile: (body) => request("/admin/profile", { method: "PUT", body }),
  updateAdminPassword: (body) => request("/admin/password", { method: "PUT", body }),
  downloadAdminExport: (report) =>
    download(`/admin/export/${encodeURIComponent(report)}`, `${report}-export.csv`),
};
