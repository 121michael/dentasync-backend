"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBackupRecoveryService } = require("../services/backupRecovery");

const enabled = process.env.RUN_LIVE_BACKUP_TESTS === "1";

test("live PostgreSQL backup and disposable restore preserve clinic records", { skip: !enabled }, async (t) => {
  const db = require("../db");
  const service = createBackupRecoveryService({ db });

  const existing = await db.query(
    `SELECT id FROM users WHERE email = 'live-patient@example.test' LIMIT 1`
  );
  if (!existing.rows.length) {
    await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ('Live', 'Patient', 'live-patient@example.test', '09170000001', 'hash', 'patient', TRUE, 'Active')`
    );
  }
  const patient = await db.query(
    `SELECT id FROM users WHERE email = 'live-patient@example.test' LIMIT 1`
  );
  const patientId = String(patient.rows[0].id);

  let appointment = await db.query(
    `SELECT id, created_at FROM patient_portal_appointments WHERE user_id = $1 LIMIT 1`,
    [patientId]
  );
  if (!appointment.rows.length) {
    await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status
       ) VALUES ($1, 'cleaning', 'Dental Cleaning / Oral Prophylaxis', 'd1', 'Dr. Test',
                 '2026-11-04', '10:00', 'self_pay', 1000, 'confirmed')`,
      [patientId]
    );
    appointment = await db.query(
      `SELECT id, created_at FROM patient_portal_appointments WHERE user_id = $1 LIMIT 1`,
      [patientId]
    );
  }
  const appointmentId = appointment.rows[0].id;
  const createdAt = appointment.rows[0].created_at;

  const queueExisting = await db.query(
    `SELECT id FROM patient_portal_queue_entries WHERE token = 'LIVE-Q1' LIMIT 1`
  );
  if (!queueExisting.rows.length) {
    await db.query(
      `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status)
       VALUES ($1, $2, 'LIVE-Q1', 1, 'checked_in')`,
      [patientId, appointmentId]
    );
  }

  await db.query(
    `UPDATE users SET email = 'live-patient@example.test' WHERE id::text = $1`,
    [patientId]
  );
  await db.query(
    `UPDATE patient_portal_appointments SET status = 'confirmed' WHERE id = $1`,
    [appointmentId]
  );

  const backup = await service.createBackup({
    type: "manual",
    actor: { id: "live-admin", first_name: "Live", last_name: "Admin" },
  });
  assert.equal(backup.status, "success");
  assert.ok(backup.byteSize > 0);
  assert.ok(backup.checksumSha256);

  const stored = await db.query(
    `SELECT octet_length(payload) AS bytes, checksum_sha256
     FROM admin_portal_backups WHERE id = $1`,
    [backup.id]
  );
  assert.equal(Number(stored.rows[0].bytes), backup.byteSize);
  assert.equal(stored.rows[0].checksum_sha256, backup.checksumSha256);

  await db.query(`UPDATE users SET email = 'mutated@example.test' WHERE id::text = $1`, [patientId]);
  await db.query(`DELETE FROM patient_portal_queue_entries WHERE token = 'LIVE-Q1'`);
  await db.query(`UPDATE patient_portal_appointments SET status = 'cancelled' WHERE id = $1`, [appointmentId]);

  await t.test("restore without RESTORE is rejected", async () => {
    await assert.rejects(
      () => service.restoreBackup({ backupId: backup.id, confirmation: "yes", actor: { id: "live-admin" } }),
      /Type RESTORE/
    );
    const stillMutated = await db.query(`SELECT email FROM users WHERE id::text = $1`, [patientId]);
    assert.equal(stillMutated.rows[0].email, "mutated@example.test");
  });

  const restored = await service.restoreBackup({
    backupId: backup.id,
    confirmation: "RESTORE",
    actor: { id: "live-admin", first_name: "Live" },
    createSafety: true,
  });
  assert.equal(restored.restored, true);
  assert.ok(restored.safetyBackup?.id);

  const users = await db.query(`SELECT email FROM users WHERE id::text = $1`, [patientId]);
  assert.equal(users.rows[0].email, "live-patient@example.test");
  const appt = await db.query(
    `SELECT id, status, created_at FROM patient_portal_appointments WHERE id = $1`,
    [appointmentId]
  );
  assert.equal(appt.rows[0].status, "confirmed");
  assert.equal(new Date(appt.rows[0].created_at).toISOString(), new Date(createdAt).toISOString());
  const queue = await db.query(`SELECT token, appointment_id FROM patient_portal_queue_entries WHERE token = 'LIVE-Q1'`);
  assert.equal(String(queue.rows[0].appointment_id), String(appointmentId));

  await db.end();
});
