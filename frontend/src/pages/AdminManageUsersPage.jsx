import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Circle, Eye, EyeOff, KeyRound, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../useAuth";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";
import { matchesNotificationFocus } from "../notificationFocus";

const TABS = [
  { id: "staff", label: "Clinic Staff" },
  { id: "dentist", label: "Dentists" },
  { id: "patient", label: "Patients" },
];

const PATIENT_ACCOUNT_TABS = [
  { id: "pending", label: "Pending Approval" },
  { id: "approved", label: "Approved" },
];

function patientAccountFilter(searchParams) {
  const filter = String(searchParams.get("filter") || "").toLowerCase();
  if (filter === "approved" || filter === "active") return "approved";
  return "pending";
}

function listPage(searchParams) {
  return Math.max(1, Number.parseInt(searchParams.get("page"), 10) || 1);
}

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  position: "Senior Desk Administrator",
  specialization: "",
  scheduleNotes: "",
  licenseNumber: "",
  licenseVerified: false,
  authorizationCredentialStatus: "none",
  credentialViewable: false,
  branchId: "",
  branchIds: [],
};

const CREDENTIAL_MASK = "••••••••";
const REVEAL_MS = 15000;
const PH_MOBILE_PATTERN = /^09[0-9]{9}$/;
const PH_MOBILE_MESSAGE = "Enter a valid 11-digit mobile number starting with 09.";
const INCOMPLETE_EMAIL_MESSAGE = "Enter a complete email address, including the full domain.";

function emailFieldError(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Enter an email address.";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return "";
  const domain = raw.includes("@") ? raw.slice(raw.indexOf("@") + 1) : "";
  if (domain && !domain.includes(".")) return INCOMPLETE_EMAIL_MESSAGE;
  return "Enter a valid email address.";
}

function isValidManageUserMobile(value) {
  return PH_MOBILE_PATTERN.test(String(value || ""));
}

function sanitizeManageUserMobileInput(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function isPendingAccount(user) {
  const status = String(user?.status || "").toLowerCase();
  return status === "pending" || status === "unverified";
}

function isRejectedAccount(user) {
  return String(user?.status || "").toLowerCase() === "rejected";
}

function isApprovedAccount(user) {
  const status = String(user?.status || "").toLowerCase();
  return Boolean(user?.verified) && (status === "active" || status === "operational");
}

function categoryLabel(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "senior" || raw === "senior_citizen") return "Senior";
  if (raw === "pediatric" || raw === "pediatric_patient") return "Pediatric";
  if (raw === "pwd") return "PWD";
  if (raw === "regular" || raw === "regular_patient") return "Regular";
  return value ? String(value) : "Regular";
}

function patientPasswordStatusLabel(user) {
  const status = String(user?.passwordStatus || "").trim();
  return status || "—";
}

function assignmentSummary(user) {
  const items = Array.isArray(user?.branches) ? user.branches : [];
  if (!items.length) return "Unassigned";
  return items
    .map((branch) => `${branch.name}${branch.inactive || branch.status !== "active" ? " (Inactive branch)" : ""}`)
    .join(", ");
}

const PATIENT_PASSWORD_MIN_LENGTH = 10;
const PATIENT_PASSWORD_MAX_BYTES = 72;
const emptyPasswordReset = { newPassword: "", confirmPassword: "", showNew: false, showConfirm: false };

function passwordByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function passwordRequirementChecks(newPassword, confirmPassword) {
  return [
    {
      id: "min",
      label: `At least ${PATIENT_PASSWORD_MIN_LENGTH} characters`,
      met: newPassword.length >= PATIENT_PASSWORD_MIN_LENGTH,
    },
    {
      id: "max",
      label: `No more than ${PATIENT_PASSWORD_MAX_BYTES} characters`,
      met: newPassword.length > 0 && passwordByteLength(newPassword) <= PATIENT_PASSWORD_MAX_BYTES,
    },
    {
      id: "match",
      label: "Both passwords match",
      met: newPassword.length > 0 && newPassword === confirmPassword,
    },
  ];
}

function passwordResetValidationError(newPassword, confirmPassword) {
  if (!newPassword || !confirmPassword) return "Enter the new password and confirm it.";
  if (newPassword.length < PATIENT_PASSWORD_MIN_LENGTH) {
    return `The new password must be at least ${PATIENT_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (passwordByteLength(newPassword) > PATIENT_PASSWORD_MAX_BYTES) {
    return `The new password must be ${PATIENT_PASSWORD_MAX_BYTES} characters or fewer.`;
  }
  if (newPassword !== confirmPassword) return "The new password and confirmation do not match.";
  return "";
}

function archiveCategoryLabel(tab) {
  if (tab === "staff") return "clinic staff";
  if (tab === "dentist") return "dentist";
  return "patient";
}

export function AdminManageUsersPage() {
  const { pushToast, confirm } = useAdminUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    return TABS.some((item) => item.id === urlTab) ? urlTab : "staff";
  });
  const [data, setData] = useState(null);
  const [pendingDependents, setPendingDependents] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [branches, setBranches] = useState([]);
  const [detail, setDetail] = useState(null);
  const [dependentDetail, setDependentDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [actionBusyId, setActionBusyId] = useState("");
  const [passwordResetTarget, setPasswordResetTarget] = useState(null);
  const [passwordReset, setPasswordReset] = useState(emptyPasswordReset);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirm, setAuthConfirm] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [resettingCredential, setResettingCredential] = useState(false);
  const focusedRowRef = useRef(null);
  const saveLock = useRef(false);
  const revealTimer = useRef(null);
  const { user: signedInAdmin } = useAuth();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [adminVerifyPassword, setAdminVerifyPassword] = useState("");
  const [showAdminVerifyPassword, setShowAdminVerifyPassword] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState("");
  const [legacyRevealMessage, setLegacyRevealMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const loader =
        tab === "patient" ? api.getAdminPatients : tab === "staff" ? api.getAdminStaff : api.getAdminDentists;
      const patientFilter = patientAccountFilter(searchParams);
      const page = listPage(searchParams);
      const [list, rejectedResponse, dependentsResponse] = await Promise.all([
        loader({
          search: applied,
          limit: 50,
          page: tab === "patient" ? page : 1,
          status: tab === "patient" ? patientFilter : undefined,
        }),
        tab === "patient" ? api.getAdminRejectedRegistrations({ limit: 100 }) : Promise.resolve({ requests: [] }),
        tab === "patient" ? api.getAdminPendingDependents().catch(() => ({ dependents: [] })) : Promise.resolve({ dependents: [] }),
      ]);
      setData(list);
      setPendingDependents(dependentsResponse.dependents || dependentsResponse.requests || []);
      setRejected((rejectedResponse.requests || []).filter((request) => request.role === "patient"));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied, searchParams, tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (formOpen && signedInAdmin) return undefined;
    hideRevealedCredential();
    closeVerifyDialog();
    return undefined;
  }, [formOpen, signedInAdmin]);

  useEffect(
    () => () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    },
    []
  );

  const users = useMemo(() => {
    if (!data) return [];
    const list = (tab === "patient" ? data.patients : tab === "staff" ? data.staff : data.dentists) || [];
    if (tab === "patient") return list;
    const filter = searchParams.get("filter");
    if (filter === "pending") {
      return list.filter((user) => isPendingAccount(user) || !user?.verified);
    }
    if (filter === "active") {
      return list.filter((user) => isApprovedAccount(user));
    }
    return list;
  }, [data, tab, searchParams]);

  const patientFilter = tab === "patient" ? patientAccountFilter(searchParams) : "";
  const tabCounts = data?.tabCounts || { pending: 0, approved: 0 };
  const currentPage = listPage(searchParams);
  const pageCount = Math.max(1, Math.ceil(Number(data?.total || 0) / Number(data?.limit || 50)));

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && TABS.some((item) => item.id === urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
    const focus = searchParams.get("focus");
    if (focus) setFocusKey(focus);
    if (urlTab === "patient" || tab === "patient") {
      const filter = String(searchParams.get("filter") || "").toLowerCase();
      if (filter === "active") {
        const next = new URLSearchParams(searchParams);
        next.set("tab", "patient");
        next.set("filter", "approved");
        setSearchParams(next, { replace: true });
      } else if (filter !== "pending" && filter !== "approved") {
        const next = new URLSearchParams(searchParams);
        next.set("tab", "patient");
        next.set("filter", "pending");
        next.delete("page");
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, tab]);

  useEffect(() => {
    let cancelled = false;
    api.getAdminBranches({ status: "all" })
      .then((response) => {
        if (!cancelled) setBranches(response.branches || []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!focusKey) return;
    if (String(focusKey).startsWith("dependent:")) {
      const id = String(focusKey).slice("dependent:".length);
      const match = pendingDependents.find((item) => String(item.id) === id);
      if (match) setDependentDetail(match);
      return undefined;
    }
    if (!users.length) return;
    const match = users.find((user) =>
      matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"])
    );
    if (!match) return;
    setDetail(match);
    const timer = window.setTimeout(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (next.has("focus")) {
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, users, pendingDependents, searchParams, setSearchParams]);

  function selectTab(nextTab) {
    setTab(nextTab);
    setSearch("");
    setApplied("");
    setData(null);
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    next.delete("page");
    if (nextTab === "patient") {
      next.set("filter", "pending");
    } else if (next.get("filter") === "pending" || next.get("filter") === "approved") {
      next.delete("filter");
    }
    setSearchParams(next, { replace: true });
  }

  function selectPatientFilter(nextFilter) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "patient");
    next.set("filter", nextFilter);
    next.delete("page");
    setSearch("");
    setApplied("");
    setData(null);
    setSearchParams(next, { replace: true });
  }

  function setListPage(nextPage) {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    setSearchParams(next, { replace: true });
  }

  function openCreate() {
    if (tab === "patient") {
      pushToast("Patients self-register. Approve pending requests below.", "warning");
      return;
    }
    setEditing(null);
    setForm({
      ...emptyForm,
      position: tab === "staff" ? "Chief Clinic Coordinator" : emptyForm.position,
    });
    setAuthPassword("");
    setAuthConfirm("");
    setShowAuthPassword(false);
    setResettingCredential(false);
    hideRevealedCredential();
    closeVerifyDialog();
    setPhoneError("");
    setFieldErrors({});
    setFormOpen(true);
  }

  async function openEdit(user) {
    if (tab === "patient") {
      pushToast("Patient portal accounts are self-registered. Use Approve or Reject instead.", "warning");
      return;
    }
    setEditing(user);
    setForm({
      ...emptyForm,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      position: user.operationalRole || user.position || "",
      specialization: user.specialization || "",
      scheduleNotes: user.scheduleNotes || "",
      licenseNumber: user.licenseNumber || "",
      licenseVerified: Boolean(user.licenseVerified),
      authorizationCredentialStatus: user.authorizationCredentialStatus || (user.setupRequired ? "setup_required" : "none"),
      credentialViewable: Boolean(user.credentialViewable),
      branchId: user.branches?.[0] ? String(user.branches[0].id) : "",
      branchIds: (user.branches || []).map((branch) => String(branch.id)),
    });
    setAuthPassword("");
    setAuthConfirm("");
    setShowAuthPassword(false);
    setResettingCredential(false);
    hideRevealedCredential();
    closeVerifyDialog();
    setPhoneError("");
    setFieldErrors({});
    setFormOpen(true);
    if (tab === "dentist") {
      try {
        const response = await api.getAdminDentistAuthorizationCredential(user.id);
        if (response?.dentist) applyAuthorizationToEditor(response.dentist);
      } catch {
        // Keep list flags when the status endpoint is unavailable.
      }
    }
  }

  function clearFieldError(name) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function saveUser(event) {
    event.preventDefault();
    if (busy || saveLock.current) return;
    if (tab === "patient") {
      pushToast("Administrators cannot create patient login accounts.", "error");
      return;
    }
    const errors = {};
    if (!String(form.firstName || "").trim()) errors.firstName = "Enter a first name.";
    if (!String(form.lastName || "").trim()) errors.lastName = "Enter a last name.";
    const emailError = emailFieldError(form.email);
    if (emailError) errors.email = emailError;
    if (!String(form.phone || "").trim()) errors.phone = "Enter a mobile number.";
    else if (!isValidManageUserMobile(form.phone)) errors.phone = PH_MOBILE_MESSAGE;
    if (!editing && form.password && form.password.length < 10) {
      errors.password = "Password must be at least 10 characters long.";
    }
    if (tab === "staff" && !form.branchId) {
      errors.branchId = "Staff must be assigned to exactly one branch.";
    }
    if (tab === "dentist" && !form.branchIds.length) {
      errors.branchIds = "Dentists must be assigned to at least one branch.";
    }
    if (tab === "dentist" && form.licenseVerified && !String(form.licenseNumber || "").trim()) {
      errors.licenseNumber = "Enter this dentist's own license number before marking it verified. Do not use another dentist's number.";
    }
    setFieldErrors(errors);
    setPhoneError(errors.phone || "");
    if (Object.keys(errors).length) {
      pushToast(Object.values(errors)[0], "error");
      return;
    }
    const payload = { ...form };
    if (tab === "staff") {
      delete payload.branchIds;
      delete payload.authorizationCredentialStatus;
    }
    if (tab === "dentist") {
      delete payload.branchId;
      delete payload.authorizationCredentialStatus;
      delete payload.credentialViewable;
      delete payload.canApproveCrossBranchAccess;
    }
    const typedCredential = String(authPassword || "");
    const typedConfirm = String(authConfirm || "");
    const wantsCredentialSave =
      tab === "dentist" &&
      editing &&
      Boolean(typedCredential || typedConfirm) &&
      typedCredential !== CREDENTIAL_MASK;
    if (wantsCredentialSave) {
      if (typedCredential.length < 10) {
        pushToast("Authorization password must be at least 10 characters long.", "error");
        return;
      }
      if (typedCredential !== typedConfirm) {
        pushToast("Authorization password and confirmation do not match.", "error");
        return;
      }
    }
    saveLock.current = true;
    setBusy(true);
    try {
      if (editing) {
        if (wantsCredentialSave) {
          const credentialResponse = await api.setAdminDentistAuthorizationCredential(editing.id, {
            password: typedCredential,
            confirmPassword: typedConfirm,
          });
          applyAuthorizationToEditor(credentialResponse.dentist);
        }
        const updater = tab === "staff" ? api.updateAdminStaff : api.updateAdminDentist;
        const updated = await updater(editing.id, payload);
        if (tab === "dentist" && updated?.dentist?.authorizationCredentialStatus) {
          applyAuthorizationToEditor(updated.dentist);
        }
        pushToast("Account updated successfully.");
      } else {
        const creator = tab === "staff" ? api.createAdminStaff : api.createAdminDentist;
        const response = await creator(payload);
        pushToast(response.message || "Profile provisioned successfully.");
      }
      setFormOpen(false);
      await load();
    } catch (saveError) {
      const returned = saveError.data?.fields;
      if (returned && typeof returned === "object") {
        setFieldErrors(returned);
        if (returned.phone) setPhoneError(returned.phone);
      }
      pushToast(saveError.message, "error");
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  function closeVerifyDialog() {
    setVerifyOpen(false);
    setAdminVerifyPassword("");
    setShowAdminVerifyPassword(false);
    setVerifyError("");
    setVerifyBusy(false);
  }

  function hideRevealedCredential() {
    if (revealTimer.current) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setRevealedPassword("");
    setLegacyRevealMessage("");
  }

  function applyAuthorizationToEditor(authorization) {
    const status = authorization?.authorizationCredentialStatus || "none";
    setForm((current) => ({
      ...current,
      authorizationCredentialStatus: status,
      credentialViewable: Boolean(authorization?.credentialViewable),
    }));
    setEditing((current) =>
      current ? { ...current, ...authorization, authorizationCredentialStatus: status } : current
    );
    setAuthPassword("");
    setAuthConfirm("");
    setResettingCredential(false);
    hideRevealedCredential();
    closeVerifyDialog();
  }

  async function saveAuthorizationCredential() {
    if (!editing || tab !== "dentist" || credentialBusy) return;
    if (authPassword.length < 10) {
      pushToast("Authorization password must be at least 10 characters long.", "error");
      return;
    }
    if (authPassword !== authConfirm) {
      pushToast("Authorization password and confirmation do not match.", "error");
      return;
    }
    setCredentialBusy(true);
    try {
      const response = await api.setAdminDentistAuthorizationCredential(editing.id, {
        password: authPassword,
        confirmPassword: authConfirm,
      });
      applyAuthorizationToEditor(response.dentist);
      pushToast(response.message || "Credential configured.");
      await load();
    } catch (credentialError) {
      pushToast(credentialError.message, "error");
    } finally {
      setCredentialBusy(false);
    }
  }

  async function submitAdminVerification(event) {
    event.preventDefault();
    if (!editing || verifyBusy) return;
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const verified = await api.verifyAdminDentistAuthorizationCredential(editing.id, {
        adminPassword: adminVerifyPassword,
      });
      setAdminVerifyPassword("");
      if (!verified.credentialViewable) {
        closeVerifyDialog();
        setRevealedPassword("");
        setLegacyRevealMessage(verified.message || "Reset this credential to enable viewing.");
        return;
      }
      const revealed = await api.revealAdminDentistAuthorizationCredential(editing.id, {
        verificationToken: verified.verificationToken,
      });
      closeVerifyDialog();
      if (!revealed.credentialViewable) {
        setRevealedPassword("");
        setLegacyRevealMessage(revealed.message || "Reset this credential to enable viewing.");
        return;
      }
      setLegacyRevealMessage("");
      setRevealedPassword(revealed.password || "");
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => {
        setRevealedPassword("");
        revealTimer.current = null;
      }, REVEAL_MS);
    } catch (verifyErr) {
      setVerifyError(verifyErr.message || "Unable to verify administrator access.");
      setRevealedPassword("");
    } finally {
      setVerifyBusy(false);
    }
  }

  async function revokeAuthorizationCredential() {
    if (!editing || tab !== "dentist" || credentialBusy) return;
    const ok = await confirm({
      title: "Revoke authorization",
      message: `Revoke ${editing.fullName || "this dentist"}'s cross-branch authorization credential? They will not be able to approve restricted record access until a new credential is set.`,
      confirmLabel: "Revoke authorization",
      tone: "danger",
    });
    if (!ok) return;
    setCredentialBusy(true);
    try {
      const response = await api.revokeAdminDentistAuthorizationCredential(editing.id);
      applyAuthorizationToEditor(response.dentist);
      pushToast(response.message || "Authorization revoked.");
      await load();
    } catch (credentialError) {
      pushToast(credentialError.message, "error");
    } finally {
      setCredentialBusy(false);
    }
  }

  async function archiveUser(user) {
    const name = user.fullName || user.email;
    const category = archiveCategoryLabel(tab);
    const ok = await confirm({
      title: "Archive User",
      message: `Are you sure you want to archive ${name}? The ${category} record will be moved to Archive Records and will no longer appear in the active user list.`,
      confirmLabel: "Confirm Archive",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${user.id}:archive`);
    try {
      const response = await api.updateAdminAccountLifecycle(user.id, "archive");
      pushToast(response.message || `${name} was moved to Archive Records.`);
      await load();
    } catch (archiveError) {
      pushToast(archiveError.message || "Unable to archive this record.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  function resetPatientPassword(user) {
    setPasswordReset(emptyPasswordReset);
    setPasswordResetError("");
    setPasswordResetTarget(user);
  }

  function closePasswordReset() {
    if (passwordResetBusy) return;
    setPasswordResetTarget(null);
    setPasswordReset(emptyPasswordReset);
    setPasswordResetError("");
  }

  function updatePasswordReset(field, value) {
    setPasswordReset((current) => ({ ...current, [field]: value }));
    setPasswordResetError("");
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    const user = passwordResetTarget;
    if (!user || passwordResetBusy) return;
    const validationError = passwordResetValidationError(passwordReset.newPassword, passwordReset.confirmPassword);
    if (validationError) {
      setPasswordResetError(validationError);
      return;
    }
    const ok = await confirm({
      title: "Confirm Password Reset",
      message: `Set a new password for ${user.fullName || "this patient"}${
        user.patientId ? ` (${user.patientId})` : ""
      }? Their current password will stop working immediately. No email will be sent.`,
      confirmLabel: "Reset Password",
      tone: "primary",
    });
    if (!ok) return;
    setPasswordResetBusy(true);
    setActionBusyId(`${user.id}:reset-password`);
    try {
      const response = await api.resetAdminAccountPassword(user.id, {
        newPassword: passwordReset.newPassword,
        confirmPassword: passwordReset.confirmPassword,
      });
      pushToast(response.message || "Password updated. The patient can now sign in with the new password.");
      setPasswordResetTarget(null);
      setPasswordReset(emptyPasswordReset);
      setPasswordResetError("");
      setDetail((current) =>
        current && String(current.id) === String(user.id)
          ? { ...current, passwordStatus: "Password set" }
          : current
      );
      await load();
    } catch (resetError) {
      const message = resetError.message || "Unable to reset the password. The patient's current password was not changed.";
      setPasswordResetError(message);
      pushToast(message, "error");
    } finally {
      setPasswordResetBusy(false);
      setActionBusyId("");
    }
  }

  async function runLifecycle(user, action, message) {
    const ok = await confirm({
      title: "Confirm lifecycle action",
      message,
      confirmLabel: action[0].toUpperCase() + action.slice(1),
      tone: ["archive", "reject", "suspend"].includes(action) ? "danger" : "primary",
    });
    if (!ok) return;
    setActionBusyId(`${user.id}:${action}`);
    try {
      const response = await api.updateAdminAccountLifecycle(user.id, action);
      pushToast(
        response.message ||
          (action === "approve"
            ? "Patient account approved successfully."
            : action === "reject"
              ? "Patient account rejected successfully."
              : "Account updated successfully.")
      );
      await load();
    } catch (lifecycleError) {
      pushToast(
        lifecycleError.message ||
          (action === "approve"
            ? "Unable to approve patient account."
            : action === "reject"
              ? "Unable to reject patient account."
              : `Unable to ${action} user.`),
        "error"
      );
    } finally {
      setActionBusyId("");
    }
  }

  async function approveRequest(request) {
    const ok = await confirm({
      title: "Approve registration",
      message: `Are you sure you want to approve ${request.fullName}?`,
      confirmLabel: "Approve",
      tone: "primary",
    });
    if (!ok) return;
    setActionBusyId(`${request.id}:approve`);
    try {
      const response = await api.approveAdminRegistration(request.id);
      pushToast(response.message || "Patient account approved successfully.");
      await load();
    } catch (approveError) {
      pushToast(approveError.message || "Unable to approve patient account.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function deletePendingRequest(request) {
    const ok = await confirm({
      title: "Permanently delete registration",
      message: `Delete ${request.fullName || request.email} completely? This cannot be undone. They can register again with the same email.`,
      confirmLabel: "Delete permanently",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${request.id}:purge`);
    try {
      const response = await api.permanentlyDeleteAdminArchived(request.id);
      pushToast(response.message || "Registration permanently deleted.");
      await load();
    } catch (deleteError) {
      pushToast(deleteError.message || "Unable to permanently delete this registration.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function rejectRequest(request) {
    const ok = await confirm({
      title: "Reject registration",
      message: "Are you sure you want to reject this patient account?",
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${request.id}:reject`);
    try {
      const response = await api.rejectAdminRegistration(request.id);
      pushToast(response.message || "Patient account rejected successfully.");
      await load();
    } catch (rejectError) {
      pushToast(rejectError.message || "Unable to reject patient account.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function approveDependent(request) {
    setActionBusyId(`dep-${request.id}:approve`);
    try {
      const response = await api.approveAdminDependent(request.id);
      pushToast(response.message || "Dependent approved.");
      setDependentDetail(null);
      await load();
    } catch (approveError) {
      pushToast(approveError.message || "Unable to approve the dependent.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function rejectDependent(request) {
    const ok = await confirm({
      title: "Reject dependent",
      message: `Reject ${request.fullName}? This request will stay rejected and the dependent will not become an active patient.`,
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`dep-${request.id}:reject`);
    try {
      const response = await api.rejectAdminDependent(request.id, { confirmed: true });
      pushToast(response.message || "Dependent request rejected.");
      setDependentDetail(null);
      await load();
    } catch (rejectError) {
      pushToast(rejectError.message || "Unable to reject the dependent.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  function renderPatientActions(user) {
    const pendingUser = isPendingAccount(user);
    const approvedUser = isApprovedAccount(user);
    return (
      <div className="admin-row-actions">
        <button className="button button--secondary button--compact" onClick={() => setDetail(user)}>
          <Eye size={14} /> View
        </button>
        {pendingUser ? (
          <>
            <button
              className="button button--primary button--compact"
              disabled={actionBusyId === `${user.id}:approve`}
              onClick={() =>
                runLifecycle(
                  user,
                  "approve",
                  `Approve ${user.fullName} so they can open the patient dashboard and book appointments?`
                )
              }
            >
              Approve
            </button>
            <button
              className="button button--danger button--compact"
              disabled={actionBusyId === `${user.id}:reject`}
              onClick={() => runLifecycle(user, "reject", "Are you sure you want to reject this patient account?")}
            >
              Reject
            </button>
            <button
              className="button button--danger button--compact"
              disabled={actionBusyId === `${user.id}:purge`}
              onClick={() => deletePendingRequest(user)}
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        ) : null}
        {approvedUser ? (
          <button
            className="button button--secondary button--compact"
            onClick={() => runLifecycle(user, "suspend", `Suspend ${user.fullName}?`)}
          >
            Suspend
          </button>
        ) : null}
        <button
          className="button button--secondary button--compact"
          disabled={actionBusyId === `${user.id}:reset-password`}
          onClick={() => resetPatientPassword(user)}
        >
          <KeyRound size={14} /> Reset Password
        </button>
        <button
          className="button button--secondary button--compact"
          disabled={actionBusyId === `${user.id}:archive`}
          onClick={() => archiveUser(user)}
        >
          <Archive size={14} /> Archive
        </button>
      </div>
    );
  }

  if (searchParams.get("tab") === "archive") {
    return <Navigate to="/admin/archived-records" replace />;
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading user accounts…" />;

  const heading =
    tab === "staff" ? "Staff Accounts" : tab === "dentist" ? "Dentist Accounts" : "Patient Portal Accounts";

  return (
    <div className={`admin-page admin-page--users ${tab === "patient" ? "admin-page--patient-accounts ops-dashboard-clearance" : ""}`}>
      <div className="admin-tabs" role="tablist" aria-label="Manage users by role">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "patient" ? (
        <div className="admin-tabs admin-tabs--patient-status" role="tablist" aria-label="Patient account approval status">
          {PATIENT_ACCOUNT_TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={patientFilter === item.id}
              className={`admin-tab ${patientFilter === item.id ? "is-active" : ""}`}
              onClick={() => selectPatientFilter(item.id)}
            >
              {item.label}
              <span className="admin-tab__count">{item.id === "pending" ? tabCounts.pending : tabCounts.approved}</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Account operations</span>
            <h2>{heading}</h2>
            <p>
              {tab === "patient" && patientFilter === "pending"
                ? "Patients awaiting Admin approval. OTP or email verification is not Admin approval. Approve accounts here so they can sign in and book."
                : tab === "patient"
                  ? "Approved, active patient accounts. Search and filters apply to this list only."
                  : searchParams.get("filter") === "pending"
                    ? "Pending accounts in this category. Switch tabs to review staff or dentist approvals."
                    : searchParams.get("filter") === "active"
                      ? "Verified operational accounts in this category."
                      : "Admin can create dentist and staff accounts only. Active accounts can be edited or archived."}
            </p>
          </div>
          {tab !== "patient" ? (
            <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Provision Profile</button>
          ) : null}
        </div>

        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setListPage(1);
            setApplied(search);
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                tab === "patient"
                  ? "Search patients by name, email, or Patient ID"
                  : `Search ${tab} accounts`
              }
            />
          </label>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {users.length ? (
          <>
          <div className={`admin-table-wrap ${tab === "patient" ? "admin-table-wrap--desktop" : ""}`}>
            <table className="admin-table">
              <thead>
                <tr>
                  {tab === "patient" ? <th>Patient ID</th> : null}
                  <th>{tab === "patient" ? "Name" : "Account Name"}</th>
                  {tab !== "patient" ? <th>System ID</th> : null}
                  {tab === "staff" ? <th>Operational Role</th> : null}
                  {tab === "dentist" ? <th>Specialization</th> : null}
                  {tab === "patient" ? <th>Email</th> : null}
                  {tab === "patient" ? <th>Phone</th> : null}
                  {tab !== "patient" ? <th>Contact Endpoint</th> : null}
                  {tab !== "patient" ? <th>Assigned Branch</th> : null}
                  {tab === "patient" ? <th>Password Status</th> : null}
                  <th>{tab === "patient" ? "Status" : "Operational Status"}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const pendingUser = isPendingAccount(user);
                  const rejectedUser = isRejectedAccount(user);
                  const approvedUser = isApprovedAccount(user);
                  return (
                    <tr
                      key={user.id}
                      ref={matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"]) ? focusedRowRef : null}
                      className={
                        matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"])
                          ? "is-notification-focus"
                          : undefined
                      }
                    >
                      {tab === "patient" ? (
                        <td><code>{user.patientId || user.id}</code></td>
                      ) : null}
                      <td>
                        <strong>{user.fullName}</strong>
                        {tab === "dentist" && user.setupRequired ? (
                          <span className="admin-set-credential__badge">Setup required</span>
                        ) : null}
                        {tab === "dentist" && user.credentialConfigured ? (
                          <span className="admin-set-credential__badge admin-set-credential__badge--ok">Credential set</span>
                        ) : null}
                      </td>
                      {tab !== "patient" ? <td><code>{user.id}</code></td> : null}
                      {tab === "staff" ? (
                        <td>{user.operationalRole || user.position || "Clinic Staff"}</td>
                      ) : null}
                      {tab === "dentist" ? (
                        <td>{user.specialization || "General Dentistry"}</td>
                      ) : null}
                      {tab === "patient" ? <td>{user.email || "—"}</td> : null}
                      {tab === "patient" ? <td>{user.phone || "—"}</td> : null}
                      {tab !== "patient" ? <td>{user.email}</td> : null}
                      {tab !== "patient" ? <td>{assignmentSummary(user)}</td> : null}
                      {tab === "patient" ? <td>{patientPasswordStatusLabel(user)}</td> : null}
                      <td>
                        <AdminStatusBadge
                          status={
                            rejectedUser
                              ? "rejected"
                              : pendingUser
                                ? "pending"
                                : approvedUser
                                  ? "active"
                                  : user.status
                          }
                        />
                      </td>
                      <td>
                        {tab === "patient" ? (
                          renderPatientActions(user)
                        ) : (
                          <div className="admin-row-actions">
                            <button className="button button--secondary button--compact" onClick={() => openEdit(user)}>
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              className="button button--secondary button--compact"
                              disabled={actionBusyId === `${user.id}:archive`}
                              onClick={() => archiveUser(user)}
                            >
                              <Archive size={14} /> Archive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {tab === "patient" ? (
            <div className="admin-account-cards">
              {users.map((user) => {
                const pendingUser = isPendingAccount(user);
                const rejectedUser = isRejectedAccount(user);
                const approvedUser = isApprovedAccount(user);
                return (
                  <article
                    key={`card-${user.id}`}
                    className={`admin-account-card ${
                      matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"])
                        ? "is-notification-focus"
                        : ""
                    }`}
                  >
                    <div className="admin-account-card__top">
                      <div>
                        <strong>{user.fullName}</strong>
                        <small><code>{user.patientId || user.id}</code></small>
                      </div>
                      <AdminStatusBadge
                        status={
                          rejectedUser
                            ? "rejected"
                            : pendingUser
                              ? "pending"
                              : approvedUser
                                ? "active"
                                : user.status
                        }
                      />
                    </div>
                    <p>{user.email || "—"}</p>
                    <p>{user.phone || "—"}</p>
                    <p>Password: {patientPasswordStatusLabel(user)}</p>
                    {renderPatientActions(user)}
                  </article>
                );
              })}
            </div>
          ) : null}
          {tab === "patient" && Number(data?.total || 0) > Number(data?.limit || 50) ? (
            <div className="admin-pager">
              <button
                type="button"
                className="button button--secondary button--compact"
                disabled={currentPage <= 1}
                onClick={() => setListPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                type="button"
                className="button button--secondary button--compact"
                disabled={currentPage >= pageCount}
                onClick={() => setListPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
          </>
        ) : (
          <EmptyState
            title={
              tab === "patient"
                ? applied
                  ? "No matching patients in this list"
                  : patientFilter === "pending"
                    ? "No patients awaiting approval"
                    : "No approved patient accounts"
                : "No accounts found"
            }
            detail={
              tab === "patient"
                ? applied
                  ? "Try a different name, email, or Patient ID in this tab."
                  : patientFilter === "pending"
                    ? "New registrations appear here until an administrator approves them."
                    : "Approved, active patient accounts appear here."
                : "Provision a dentist or staff profile to get started."
            }
          />
        )}
      </section>

      {tab === "patient" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Dependent approval</span>
                <h2>Pending Dependent Requests</h2>
                <p>
                  Account holders submit dependents under their existing login. Approve to create a separate patient
                  record and Patient ID. Staff and dentists cannot approve these requests.
                </p>
              </div>
            </div>
            {pendingDependents.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Dependent Name</th>
                      <th>Relationship</th>
                      <th>Account Holder</th>
                      <th>Submitted Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDependents.map((request) => (
                      <tr key={`dep-${request.id}`}>
                        <td><strong>{request.fullName}</strong></td>
                        <td className="capitalize">{request.relationship}</td>
                        <td>{request.accountHolderName || "—"}</td>
                        <td>{formatAdminDate(request.submittedAt || request.createdAt)}</td>
                        <td><AdminStatusBadge status="pending" /></td>
                        <td>
                          <div className="admin-row-actions">
                            <button className="button button--secondary button--compact" onClick={() => setDependentDetail(request)}>
                              View
                            </button>
                            <button
                              className="button button--primary button--compact"
                              disabled={actionBusyId === `dep-${request.id}:approve`}
                              onClick={() => approveDependent(request)}
                            >
                              Approve
                            </button>
                            <button
                              className="button button--danger button--compact"
                              disabled={actionBusyId === `dep-${request.id}:reject`}
                              onClick={() => rejectDependent(request)}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No pending dependents" detail="Newly submitted dependents will appear here for Admin review." />
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Rejected accounts</span>
                <h2>Rejected Patient Registrations</h2>
                <p>
                  Rejected accounts remain available for review. Newly rejected users are appended at the bottom of this list.
                </p>
              </div>
            </div>
            {rejected.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Full Name</th>
                      <th>Email</th>
                      <th>Contact Number</th>
                      <th>Rejected</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.map((request) => (
                      <tr key={request.id}>
                        <td><strong>{request.fullName}</strong></td>
                        <td>{request.email}</td>
                        <td>{request.phone || "—"}</td>
                        <td>{formatAdminDate(request.statusChangedAt || request.createdAt)}</td>
                        <td><AdminStatusBadge status="rejected" /></td>
                        <td>
                          <div className="admin-row-actions">
                            <button className="button button--secondary button--compact" onClick={() => setDetail(request)}>View Details</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No rejected registrations" detail="Rejected patient accounts will appear here." />
            )}
          </section>
        </>
      ) : null}

      {formOpen ? (
        <AdminModal
          title={editing ? "Edit account" : "Provision Profile"}
          onClose={() => {
            hideRevealedCredential();
            closeVerifyDialog();
            setFormOpen(false);
          }}
          wide
        >
          <form className="admin-form admin-form--manage-user" onSubmit={saveUser} noValidate>
            <div className="admin-form--manage-user__grid">
              <label>
                First name
                <input
                  required
                  value={form.firstName}
                  aria-invalid={fieldErrors.firstName ? "true" : "false"}
                  onChange={(e) => {
                    setForm({ ...form, firstName: e.target.value });
                    clearFieldError("firstName");
                  }}
                />
                {fieldErrors.firstName ? <span className="admin-form--manage-user__error">{fieldErrors.firstName}</span> : null}
              </label>
              <label>
                Last name
                <input
                  required
                  value={form.lastName}
                  aria-invalid={fieldErrors.lastName ? "true" : "false"}
                  onChange={(e) => {
                    setForm({ ...form, lastName: e.target.value });
                    clearFieldError("lastName");
                  }}
                />
                {fieldErrors.lastName ? <span className="admin-form--manage-user__error">{fieldErrors.lastName}</span> : null}
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={form.email}
                  aria-invalid={fieldErrors.email ? "true" : "false"}
                  onChange={(e) => {
                    setForm({ ...form, email: e.target.value });
                    clearFieldError("email");
                  }}
                />
                {fieldErrors.email ? <span className="admin-form--manage-user__error">{fieldErrors.email}</span> : null}
              </label>
              <label>
                Mobile Number
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={Math.max(11, String(form.phone || "").length)}
                  pattern="09[0-9]{9}"
                  placeholder="09XXXXXXXXX"
                  value={form.phone}
                  aria-invalid={phoneError || (form.phone && !isValidManageUserMobile(form.phone)) ? "true" : "false"}
                  onChange={(e) => {
                    setForm({ ...form, phone: sanitizeManageUserMobileInput(e.target.value) });
                    setPhoneError("");
                    clearFieldError("phone");
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    const pasted = event.clipboardData.getData("text");
                    setForm({ ...form, phone: sanitizeManageUserMobileInput(pasted) });
                    setPhoneError("");
                  }}
                />
                {phoneError || (form.phone && !isValidManageUserMobile(form.phone)) ? (
                  <span className="admin-form--manage-user__error">{phoneError || PH_MOBILE_MESSAGE}</span>
                ) : null}
              </label>
              {!editing ? (
                <label className="admin-form--manage-user__full">
                  Temporary password
                  <input
                    type="password"
                    value={form.password}
                    aria-invalid={fieldErrors.password ? "true" : "false"}
                    onChange={(e) => {
                      setForm({ ...form, password: e.target.value });
                      clearFieldError("password");
                    }}
                    placeholder="Optional"
                  />
                  {fieldErrors.password ? <span className="admin-form--manage-user__error">{fieldErrors.password}</span> : null}
                </label>
              ) : null}
              {tab === "staff" || tab === "dentist" ? (
                <label className="admin-form--manage-user__full">
                  Assigned branch{tab === "dentist" ? "es" : ""}
                  {tab === "staff" ? (
                    <>
                    <select
                      required
                      value={form.branchId}
                      aria-invalid={fieldErrors.branchId ? "true" : "false"}
                      onChange={(event) => {
                        setForm({ ...form, branchId: event.target.value });
                        clearFieldError("branchId");
                      }}
                    >
                      <option value="">Select one branch</option>
                      {branches
                        .filter((branch) => branch.status === "active" || String(branch.id) === String(form.branchId))
                        .map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}{branch.status !== "active" ? " (Inactive branch)" : ""}
                          </option>
                        ))}
                    </select>
                    {fieldErrors.branchId ? <span className="admin-form--manage-user__error">{fieldErrors.branchId}</span> : null}
                    </>
                  ) : (
                    <>
                    <span className="admin-branch-choices">
                      {branches
                        .filter((branch) => branch.status === "active" || form.branchIds.includes(String(branch.id)))
                        .map((branch) => {
                          const id = String(branch.id);
                          const checked = form.branchIds.includes(id);
                          return (
                            <label key={id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...form.branchIds, id]
                                    : form.branchIds.filter((value) => value !== id);
                                  setForm({ ...form, branchIds: next });
                                }}
                              />
                              {branch.name}{branch.status !== "active" ? " (Inactive branch)" : ""}
                            </label>
                          );
                        })}
                    </span>
                    {fieldErrors.branchIds ? <span className="admin-form--manage-user__error">{fieldErrors.branchIds}</span> : null}
                    </>
                  )}
                </label>
              ) : null}
              {tab === "staff" ? (
                <label className="admin-form--manage-user__full">
                  Operational role
                  <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                    <option>Chief Clinic Coordinator</option>
                    <option>Senior Desk Administrator</option>
                    <option>Clinic Staff</option>
                  </select>
                </label>
              ) : null}
              {tab === "dentist" ? (
                <>
                  <label className="admin-form--manage-user__full">
                    Specialization
                    <input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
                  </label>
                  <label className="admin-form--manage-user__full">
                    Schedule notes
                    <textarea value={form.scheduleNotes} onChange={(e) => setForm({ ...form, scheduleNotes: e.target.value })} />
                  </label>
                  <label className="admin-form--manage-user__full">
                    PRC license number
                    <input
                      value={form.licenseNumber || ""}
                      aria-invalid={fieldErrors.licenseNumber ? "true" : "false"}
                      onChange={(e) => {
                        setForm({ ...form, licenseNumber: e.target.value, licenseVerified: false });
                        clearFieldError("licenseNumber");
                      }}
                      placeholder="This dentist's own license number"
                    />
                    {fieldErrors.licenseNumber ? <span className="admin-form--manage-user__error">{fieldErrors.licenseNumber}</span> : null}
                  </label>
                  <label className="admin-form--manage-user__full admin-license-verify">
                    <input
                      type="checkbox"
                      checked={Boolean(form.licenseVerified)}
                      onChange={(e) => setForm({ ...form, licenseVerified: e.target.checked })}
                    />
                    <span>
                      I verified this license number against this dentist's professional record. Prescriptions stay blocked until this is checked. Do not enter another dentist's number.
                    </span>
                  </label>
                  {editing ? (
                    <fieldset className="admin-form--manage-user__full admin-set-credential">
                      <legend>Set Credential</legend>
                      <p>
                        Separate authorization password this dentist uses to approve another dentist’s access to
                        restricted cross-branch records. It does not sign them in and does not open charts by itself.
                      </p>
                      {form.authorizationCredentialStatus === "setup_required" ? (
                        <p className="admin-set-credential__status admin-set-credential__status--warn">Setup required</p>
                      ) : null}
                      {form.authorizationCredentialStatus === "configured" && !resettingCredential ? (
                        <>
                          <label>
                            Authorization password
                            <span className="admin-password-reset__input">
                              <input
                                type={revealedPassword ? "text" : "password"}
                                value={revealedPassword || CREDENTIAL_MASK}
                                readOnly
                                disabled
                                autoComplete="off"
                                name="authorization-credential-mask"
                                data-credential-mask="true"
                              />
                              <button
                                type="button"
                                className="admin-set-credential__toggle"
                                onClick={() => {
                                  setVerifyError("");
                                  setAdminVerifyPassword("");
                                  setVerifyOpen(true);
                                }}
                                aria-label="View authorization password"
                              >
                                <Eye size={16} />
                              </button>
                            </span>
                          </label>
                          <p className="admin-set-credential__status admin-set-credential__status--ok">Credential set.</p>
                          {legacyRevealMessage ? (
                            <p className="admin-set-credential__status admin-set-credential__status--warn">{legacyRevealMessage}</p>
                          ) : null}
                          <div className="admin-set-credential__actions">
                            <button
                              type="button"
                              className="button button--secondary"
                              disabled={credentialBusy}
                              onClick={() => {
                                hideRevealedCredential();
                                setResettingCredential(true);
                              }}
                            >
                              Reset credential
                            </button>
                            <button
                              type="button"
                              className="button button--danger"
                              disabled={credentialBusy}
                              onClick={revokeAuthorizationCredential}
                            >
                              {credentialBusy ? "Working…" : "Revoke credential"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {form.authorizationCredentialStatus === "revoked" && !resettingCredential ? (
                            <p className="admin-set-credential__status">Authorization revoked. Set a new credential to restore approval permission.</p>
                          ) : resettingCredential ? (
                            <p className="admin-set-credential__status">Enter a new authorization password. The previous stored copy is replaced on save.</p>
                          ) : (
                            <p className="admin-set-credential__status">No authorization credential is stored yet.</p>
                          )}
                          <label>
                            Authorization password
                            <span className="admin-password-reset__input">
                              <input
                                type={showAuthPassword ? "text" : "password"}
                                value={authPassword}
                                autoComplete="new-password"
                                onChange={(event) => setAuthPassword(event.target.value)}
                              />
                              <button
                                type="button"
                                className="admin-set-credential__toggle"
                                onClick={() => setShowAuthPassword((current) => !current)}
                                aria-label={showAuthPassword ? "Hide authorization password" : "Show authorization password"}
                              >
                                {showAuthPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            </span>
                          </label>
                          <label>
                            Confirm password
                            <input
                              type={showAuthPassword ? "text" : "password"}
                              value={authConfirm}
                              autoComplete="new-password"
                              onChange={(event) => setAuthConfirm(event.target.value)}
                            />
                          </label>
                          <div className="admin-set-credential__actions">
                            <button
                              type="button"
                              className="button button--primary"
                              disabled={credentialBusy}
                              onClick={saveAuthorizationCredential}
                            >
                              {credentialBusy ? "Saving…" : resettingCredential ? "Save new credential" : "Save credential"}
                            </button>
                            {resettingCredential ? (
                              <button
                                type="button"
                                className="button button--secondary"
                                disabled={credentialBusy}
                                onClick={() => {
                                  setResettingCredential(false);
                                  setAuthPassword("");
                                  setAuthConfirm("");
                                }}
                              >
                                Cancel reset
                              </button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </fieldset>
                  ) : (
                    <p className="admin-form--manage-user__full admin-set-credential__hint">
                      After this dentist is created, open Edit Dentist to set their authorization credential.
                    </p>
                  )}
                </>
              ) : null}
            </div>
            <div className="admin-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  hideRevealedCredential();
                  closeVerifyDialog();
                  setFormOpen(false);
                }}
              >
                Cancel
              </button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {verifyOpen ? (
        <AdminModal title="Verify administrator" onClose={closeVerifyDialog}>
          <form className="admin-form admin-form--manage-user admin-set-credential-verify" onSubmit={submitAdminVerification}>
            <p>
              Enter your own Admin login password to view this dentist’s authorization credential. This does not
              unlock other dentists and is required again the next time you view.
            </p>
            <label htmlFor="admin-credential-verify-password">
              Administrator password
              <span className="admin-password-reset__input">
                <input
                  id="admin-credential-verify-password"
                  type={showAdminVerifyPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={adminVerifyPassword}
                  disabled={verifyBusy}
                  onChange={(event) => setAdminVerifyPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="field__visibility"
                  onClick={() => setShowAdminVerifyPassword((current) => !current)}
                  aria-label={showAdminVerifyPassword ? "Hide administrator password" : "Show administrator password"}
                >
                  {showAdminVerifyPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {verifyError ? (
              <p className="admin-form--manage-user__error" role="alert">
                {verifyError}
              </p>
            ) : null}
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={closeVerifyDialog} disabled={verifyBusy}>
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={verifyBusy}>
                {verifyBusy ? "Verifying…" : "View credential"}
              </button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {dependentDetail ? (
        <AdminModal title="Dependent request" onClose={() => setDependentDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><small>Dependent</small><strong>{dependentDetail.fullName}</strong></p>
            <p><small>Relationship</small><strong className="capitalize">{dependentDetail.relationship}</strong></p>
            <p><small>Account holder</small><strong>{dependentDetail.accountHolderName || "—"}</strong></p>
            <p><small>Holder email</small><strong>{dependentDetail.accountHolderEmail || "—"}</strong></p>
            <p><small>Holder Patient ID</small><strong>{dependentDetail.accountHolderPatientId || "—"}</strong></p>
            <p><small>Birthdate</small><strong>{dependentDetail.dateOfBirth || "—"}</strong></p>
            <p><small>Age</small><strong>{dependentDetail.age ?? "—"}</strong></p>
            <p><small>Sex</small><strong>{dependentDetail.gender || "—"}</strong></p>
            <p><small>Phone</small><strong>{dependentDetail.phone || "—"}</strong></p>
            <p><small>Category</small><strong>{categoryLabel(dependentDetail.patientCategory)}</strong></p>
            <p><small>Submitted</small><strong>{formatAdminDate(dependentDetail.submittedAt || dependentDetail.createdAt)}</strong></p>
            <p><small>Status</small><strong className="capitalize">{dependentDetail.approvalStatus}</strong></p>
          </div>
          {String(dependentDetail.approvalStatus).toLowerCase() === "pending" ? (
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setDependentDetail(null)}>Close</button>
              <button
                type="button"
                className="button button--danger"
                disabled={actionBusyId === `dep-${dependentDetail.id}:reject`}
                onClick={() => rejectDependent(dependentDetail)}
              >
                Reject
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={actionBusyId === `dep-${dependentDetail.id}:approve`}
                onClick={() => approveDependent(dependentDetail)}
              >
                Approve
              </button>
            </div>
          ) : null}
        </AdminModal>
      ) : null}
      {detail ? (
        <AdminModal title="Account details" onClose={() => setDetail(null)}>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.fullName}</strong></p>
            {detail.patientId ? <p><small>Patient ID</small><strong>{detail.patientId}</strong></p> : null}
            <p><small>System ID</small><strong>{detail.id}</strong></p>
            <p><small>Email</small><strong>{detail.email}</strong></p>
            <p><small>Phone</small><strong>{detail.phone || "—"}</strong></p>
            <p><small>Role</small><strong className="capitalize">{detail.role}</strong></p>
            {String(detail.role || "").toLowerCase() === "staff" || String(detail.role || "").toLowerCase() === "dentist" ? (
              <p><small>Assigned branch</small><strong>{assignmentSummary(detail)}</strong></p>
            ) : null}
            {detail.patientCategory ? (
              <p><small>Category</small><strong>{categoryLabel(detail.patientCategory)}</strong></p>
            ) : null}
            <p><small>Status</small><strong className="capitalize">{detail.status}</strong></p>
            {String(detail.role || "").toLowerCase() === "patient" ? (
              <p><small>Password status</small><strong>{patientPasswordStatusLabel(detail)}</strong></p>
            ) : null}
          </div>
          {String(detail.role || "").toLowerCase() === "patient" ? (
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setDetail(null)}>
                Close
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={actionBusyId === `${detail.id}:reset-password`}
                onClick={() => {
                  const user = detail;
                  setDetail(null);
                  resetPatientPassword(user);
                }}
              >
                Reset Password
              </button>
            </div>
          ) : null}
        </AdminModal>
      ) : null}
      {passwordResetTarget ? (
        <AdminModal title="Reset Patient Password" onClose={closePasswordReset}>
          <form className="admin-form admin-form--manage-user admin-password-reset" onSubmit={submitPasswordReset} noValidate>
            <div className="admin-password-reset__patient">
              <span className="admin-password-reset__icon" aria-hidden="true">
                <KeyRound size={18} />
              </span>
              <div>
                <strong>{passwordResetTarget.fullName || "Patient account"}</strong>
                <small>
                  {passwordResetTarget.patientId ? `Patient ID ${passwordResetTarget.patientId}` : `System ID ${passwordResetTarget.id}`}
                </small>
              </div>
            </div>
            <p className="admin-password-reset__copy">
              Set a new password for this patient. No email or verification code is sent. Share the new password with
              the patient privately.
            </p>
            {[
              { field: "newPassword", toggle: "showNew", label: "New Password", id: "admin-reset-new-password" },
              { field: "confirmPassword", toggle: "showConfirm", label: "Confirm New Password", id: "admin-reset-confirm-password" },
            ].map((input) => (
              <label key={input.field} htmlFor={input.id}>
                {input.label}
                <span className="admin-password-reset__input">
                  <input
                    id={input.id}
                    type={passwordReset[input.toggle] ? "text" : "password"}
                    autoComplete="new-password"
                    value={passwordReset[input.field]}
                    disabled={passwordResetBusy}
                    aria-invalid={passwordResetError ? "true" : "false"}
                    aria-describedby="admin-reset-requirements"
                    onChange={(event) => updatePasswordReset(input.field, event.target.value)}
                  />
                  <button
                    type="button"
                    className="field__visibility"
                    onClick={() => updatePasswordReset(input.toggle, !passwordReset[input.toggle])}
                    aria-label={passwordReset[input.toggle] ? `Hide ${input.label.toLowerCase()}` : `Show ${input.label.toLowerCase()}`}
                  >
                    {passwordReset[input.toggle] ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
            ))}
            <ul className="admin-password-reset__rules" id="admin-reset-requirements">
              {passwordRequirementChecks(passwordReset.newPassword, passwordReset.confirmPassword).map((rule) => (
                <li key={rule.id} className={rule.met ? "is-met" : ""}>
                  {rule.met ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                  {rule.label}
                </li>
              ))}
            </ul>
            {passwordResetError ? (
              <p className="admin-form--manage-user__error" role="alert">{passwordResetError}</p>
            ) : null}
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={closePasswordReset} disabled={passwordResetBusy}>
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={passwordResetBusy}>
                {passwordResetBusy ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </form>
        </AdminModal>
      ) : null}
    </div>
  );
}
