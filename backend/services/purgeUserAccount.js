"use strict";

let savepointSeq = 0;

async function ignoreMissing(client, sql, params) {
  const savepoint = `purge_${++savepointSeq}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    if (error?.code !== "42P01" && error?.code !== "42703") {
      throw error;
    }
  }
}

async function unlinkClinicalIdentity(client, id) {
  await ignoreMissing(
    client,
    `UPDATE clinic_patient_treatments AS treatment
     SET queue_entry_id = NULL,
         appointment_id = NULL
     FROM clinic_patient_records AS record
     WHERE treatment.clinical_record_id = record.id
       AND record.linked_user_id = $1`,
    [id]
  );
  await ignoreMissing(
    client,
    `UPDATE clinic_patient_treatments
     SET queue_entry_id = NULL
     WHERE queue_entry_id IN (SELECT id FROM patient_portal_queue_entries WHERE user_id = $1)`,
    [id]
  );
  await ignoreMissing(
    client,
    `UPDATE clinic_patient_treatments
     SET appointment_id = NULL
     WHERE appointment_id IN (SELECT id FROM patient_portal_appointments WHERE user_id = $1)`,
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE clinic_patient_records SET linked_user_id = NULL WHERE linked_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE dental_procedure_authorizations SET linked_user_id = NULL WHERE linked_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE dental_wellness_assessments SET patient_user_id = NULL WHERE patient_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE prescriptions SET linked_user_id = NULL WHERE linked_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE record_access_requests SET patient_user_id = NULL WHERE patient_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE record_access_challenges SET patient_user_id = NULL WHERE patient_user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE admin_portal_document_sync_jobs SET linked_patient_id = NULL WHERE linked_patient_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE ai_usage_events SET user_id = NULL WHERE user_id = $1",
    [id]
  );
  await ignoreMissing(
    client,
    `UPDATE clinic_treatment_durations
     SET patient_user_id = NULL,
         appointment_id = NULL,
         queue_entry_id = NULL
     WHERE patient_user_id = $1
        OR appointment_id IN (SELECT id FROM patient_portal_appointments WHERE user_id = $1)
        OR queue_entry_id IN (SELECT id FROM patient_portal_queue_entries WHERE user_id = $1)`,
    [id]
  );
  await ignoreMissing(
    client,
    "UPDATE staff_portal_invoices SET patient_user_id = NULL WHERE patient_user_id = $1",
    [id]
  );
}

async function deleteAccountOwnedRows(client, id) {
  const relatedDeletes = [
    "DELETE FROM patient_xray_analyses WHERE user_id = $1",
    "DELETE FROM patient_portal_documents WHERE user_id = $1",
    "DELETE FROM patient_hmo_submissions WHERE user_id = $1",
    "DELETE FROM clinic_appointment_sms_reminders WHERE patient_user_id = $1",
    "DELETE FROM clinic_sms_reminder_runs WHERE patient_user_id = $1",
    "DELETE FROM clinic_sms_logs WHERE patient_user_id = $1",
    "DELETE FROM otp_verification_requests WHERE user_id = $1",
    "DELETE FROM password_reset_requests WHERE user_id = $1",
    "DELETE FROM patient_portal_login_activity WHERE user_id = $1",
    "DELETE FROM patient_portal_notifications WHERE user_id = $1",
    "DELETE FROM patient_portal_treatment_records WHERE user_id = $1",
    "DELETE FROM patient_portal_queue_entries WHERE user_id = $1",
    "DELETE FROM patient_portal_appointments WHERE user_id = $1",
    "DELETE FROM patient_portal_preferences WHERE user_id = $1",
    "DELETE FROM patient_portal_profiles WHERE user_id = $1",
    "DELETE FROM patient_portal_dependents WHERE guardian_user_id = $1 OR dependent_user_id = $1",
    "DELETE FROM staff_portal_notifications WHERE user_id = $1",
    "DELETE FROM staff_walkin_qr_redemptions WHERE patient_user_id = $1",
    "DELETE FROM dentist_portal_notifications WHERE user_id = $1",
    "DELETE FROM admin_portal_notifications WHERE user_id = $1",
    "DELETE FROM admin_portal_staff_profiles WHERE user_id = $1",
    "DELETE FROM admin_portal_dentist_profiles WHERE user_id = $1",
    "DELETE FROM clinic_branch_assignments WHERE user_id::text = $1",
    "DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE user_id = $1)",
    "DELETE FROM ai_conversations WHERE user_id = $1",
  ];

  for (const sql of relatedDeletes) {
    await ignoreMissing(client, sql, [id]);
  }

  await ignoreMissing(
    client,
    "UPDATE users SET managed_by_user_id = NULL WHERE managed_by_user_id = $1",
    [id]
  );
}

async function purgeUserAccount(client, userId) {
  const id = String(userId);
  await unlinkClinicalIdentity(client, id);
  await deleteAccountOwnedRows(client, id);

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

const RELATED_RECORD_BLOCK_MESSAGE =
  "This archived account could not be deleted because related clinic records must stay on file. The login was not removed and can still be restored.";

module.exports = {
  purgeUserAccount,
  canPermanentlyDeleteAccount,
  RELATED_RECORD_BLOCK_MESSAGE,
};
