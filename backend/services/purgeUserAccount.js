"use strict";

async function ignoreMissing(client, sql, params) {
  try {
    await client.query(sql, params);
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      throw error;
    }
  }
}

async function purgeUserAccount(client, userId) {
  const id = String(userId);
  const relatedDeletes = [
    "DELETE FROM otp_verification_requests WHERE user_id = $1",
    "DELETE FROM password_reset_requests WHERE user_id = $1",
    "DELETE FROM patient_portal_login_activity WHERE user_id = $1",
    "DELETE FROM patient_portal_notifications WHERE user_id = $1",
    "DELETE FROM patient_portal_documents WHERE user_id = $1",
    "DELETE FROM patient_portal_treatment_records WHERE user_id = $1",
    "DELETE FROM patient_portal_queue_entries WHERE user_id = $1",
    "DELETE FROM patient_portal_appointments WHERE user_id = $1",
    "DELETE FROM patient_portal_preferences WHERE user_id = $1",
    "DELETE FROM patient_portal_profiles WHERE user_id = $1",
    "DELETE FROM patient_portal_dependents WHERE guardian_user_id = $1 OR dependent_user_id = $1",
    "DELETE FROM patient_xray_analyses WHERE user_id = $1",
    "DELETE FROM staff_portal_notifications WHERE user_id = $1",
    "DELETE FROM staff_walkin_qr_redemptions WHERE patient_user_id = $1",
    "DELETE FROM dentist_portal_notifications WHERE user_id = $1",
    "DELETE FROM admin_portal_notifications WHERE user_id = $1",
    "DELETE FROM admin_portal_staff_profiles WHERE user_id = $1",
    "DELETE FROM admin_portal_dentist_profiles WHERE user_id = $1",
    "DELETE FROM clinic_sms_logs WHERE patient_user_id = $1",
    "DELETE FROM clinic_sms_reminder_runs WHERE patient_user_id = $1",
  ];

  for (const sql of relatedDeletes) {
    await ignoreMissing(client, sql, [id]);
  }

  await ignoreMissing(
    client,
    "UPDATE clinic_patient_records SET linked_user_id = NULL WHERE linked_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE staff_portal_invoices SET patient_user_id = NULL WHERE patient_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE users SET managed_by_user_id = NULL WHERE managed_by_user_id = $1",
    [id]
  );

  const deleted = await client.query(
    "DELETE FROM users WHERE id::text = $1 RETURNING id, email, role",
    [id]
  );
  return deleted.rows[0] || null;
}

function canPermanentlyDeleteAccount(target) {
  if (!target) return false;
  const role = String(target.role || "").toLowerCase();
  if (role === "admin") return false;
  if (target.is_archived) return true;
  if (role !== "patient") return false;
  const status = String(target.status || "pending").toLowerCase();
  return !target.is_verified || ["pending", "unverified", "rejected"].includes(status);
}

module.exports = {
  purgeUserAccount,
  canPermanentlyDeleteAccount,
};
