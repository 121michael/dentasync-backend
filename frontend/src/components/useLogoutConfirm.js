import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../useAuth";

export function useLogoutConfirm() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestLogout = useCallback(() => {
    if (busy) return;
    setOpen(true);
  }, [busy]);

  const cancelLogout = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const confirmLogout = useCallback(() => {
    if (busy) return;
    setBusy(true);
    logout();
    navigate("/login", { replace: true });
  }, [busy, logout, navigate]);

  return { requestLogout, logoutDialogProps: { open, busy, onCancel: cancelLogout, onConfirm: confirmLogout } };
}
