"use strict";

const multer = require("multer");
const { writeAdminAudit } = require("../services/adminAudit");
const {
  MAX_BACKUP_BYTES,
  createBackupRecoveryService,
} = require("../services/backupRecovery");

function stringValue(value, maxLength = 120) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sendServiceError(res, error, fallback) {
  const status = Number(error.status) || (error.code === "42P01" ? 503 : 500);
  if (status >= 500) {
    console.error(fallback, error.message);
  }
  const message =
    error.code === "42P01"
      ? "Backup storage is not installed. Run npm run migrate:admin-backups."
      : error.message || fallback;
  return res.status(status).json({ message });
}

async function audit(db, req, entry) {
  await writeAdminAudit(db, {
    actorId: req.admin?.id,
    actorName: `${req.admin?.first_name || ""} ${req.admin?.last_name || ""}`.trim(),
    actorRole: "admin",
    ipAddress: req.ip,
    ...entry,
  });
}

function attachAdminBackupRoutes(router, { db }) {
  const backups = createBackupRecoveryService({ db });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BACKUP_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      const name = String(file.originalname || "").toLowerCase();
      if (name.endsWith(".dsb") || name.endsWith(".json.gz") || name.endsWith(".gz")) {
        cb(null, true);
        return;
      }
      cb(new Error("Upload a .dsb DentaSync backup file."));
    },
  });

  router.get("/backups", async (req, res) => {
    try {
      const overview = await backups.getOverview();
      return res.json(overview);
    } catch (error) {
      return sendServiceError(res, error, "Unable to load backup history.");
    }
  });

  router.get("/backups/settings", async (req, res) => {
    try {
      return res.json({ settings: await backups.loadSettings() });
    } catch (error) {
      return sendServiceError(res, error, "Unable to load backup settings.");
    }
  });

  router.put("/backups/settings", async (req, res) => {
    try {
      const settings = await backups.saveSettings(req.body || {}, req.admin);
      await audit(db, req, {
        action: "update_backup_settings",
        targetType: "backup_settings",
        result: "success",
        detail: `schedule=${settings.schedule}; retention=${settings.retentionCount}`,
      });
      return res.json({ message: "Backup settings saved.", settings });
    } catch (error) {
      return sendServiceError(res, error, "Unable to save backup settings.");
    }
  });

  router.post("/backups/postgres", async (req, res) => {
    try {
      const backup = await backups.createPostgresDump({ actor: req.admin });
      await audit(db, req, {
        action: "create_postgres_backup",
        targetType: "backup",
        targetId: backup.id,
        targetLabel: backup.fileName,
        result: "success",
        detail: `PostgreSQL .dump stored (${backup.byteSize} bytes, ${backup.checksumSha256}).`,
      });
      return res.status(201).json({
        message: "Backup created. This .dump is PostgreSQL data only. Uploaded X-rays and PDFs need their own backup.",
        backup,
      });
    } catch (error) {
      await audit(db, req, {
        action: "create_postgres_backup",
        targetType: "backup",
        result: "failed",
        detail: String(error.message || "PostgreSQL backup failed.").slice(0, 300),
      });
      return sendServiceError(res, error, "Unable to create PostgreSQL backup.");
    }
  });

  router.post("/backups", async (req, res) => {
    try {
      const backup = await backups.createBackup({ type: "manual", actor: req.admin });
      await audit(db, req, {
        action: "create_backup",
        targetType: "backup",
        targetId: backup.id,
        targetLabel: backup.fileName,
        result: "success",
        detail: `Manual backup stored (${backup.byteSize} bytes).`,
      });
      return res.status(201).json({
        message: "Backup created successfully.",
        backup,
      });
    } catch (error) {
      await audit(db, req, {
        action: "create_backup",
        targetType: "backup",
        result: "failed",
        detail: error.message,
      });
      return sendServiceError(res, error, "Unable to create backup.");
    }
  });

  router.get("/backups/:id", async (req, res) => {
    try {
      const id = stringValue(req.params.id, 80);
      const row = await backups.getBackupRow(id);
      if (!row) {
        return res.status(404).json({ message: "Backup not found." });
      }
      return res.json({ backup: backups.publicBackup(row) });
    } catch (error) {
      return sendServiceError(res, error, "Unable to load backup details.");
    }
  });

  router.get("/backups/:id/download", async (req, res) => {
    try {
      const id = stringValue(req.params.id, 80);
      const row = await backups.getBackupRow(id, { includePayload: true });
      if (!row) {
        return res.status(404).json({ message: "Backup not found." });
      }
      if (row.status !== "success") {
        return res.status(400).json({ message: "Only a completed backup can be downloaded." });
      }
      const payload = await backups.loadArchiveBuffer(row);
      await audit(db, req, {
        action: "download_backup",
        targetType: "backup",
        targetId: row.id,
        targetLabel: row.file_name,
        result: "success",
        detail: "Administrator downloaded a backup archive.",
      });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${String(row.file_name || "dentasync-backup.dsb").replace(/"/g, "")}"`
      );
      res.setHeader("Cache-Control", "no-store");
      return res.send(payload);
    } catch (error) {
      return sendServiceError(res, error, "Unable to download backup.");
    }
  });

  router.post("/backups/:id/validate", async (req, res) => {
    try {
      const result = await backups.validateBackup({
        backupId: stringValue(req.params.id, 80),
        actor: req.admin,
      });
      await audit(db, req, {
        action: "validate_backup",
        targetType: "backup",
        targetId: result.backup.id,
        result: "success",
        detail: "Administrator validated backup integrity.",
      });
      return res.json({ message: "Backup archive passed integrity checks.", ...result });
    } catch (error) {
      return sendServiceError(res, error, "Unable to validate backup.");
    }
  });

  router.post("/backups/:id/dump-test-restore", async (req, res) => {
    try {
      const result = await backups.testRestorePostgresDump({
        backupId: stringValue(req.params.id, 80),
        actor: req.admin,
      });
      await audit(db, req, {
        action: "dump_test_restore",
        targetType: "backup",
        targetId: result.backup?.id,
        result: "success",
        detail: "Test restore passed in a separate empty database. Live data was not replaced.",
      });
      return res.json({
        message: "Test restore passed. The live database was not replaced.",
        ...result,
      });
    } catch (error) {
      return sendServiceError(res, error, "Unable to test-restore this PostgreSQL dump.");
    }
  });

  router.post("/backups/:id/isolated-restore", async (req, res) => {
    try {
      const result = await backups.isolatedRestore({
        backupId: stringValue(req.params.id, 80),
        actor: req.admin,
      });
      await audit(db, req, {
        action: "isolated_restore_backup",
        targetType: "backup",
        targetId: stringValue(req.params.id, 80),
        result: "success",
        detail: "Isolated restore test rolled back without changing production data.",
      });
      return res.json({
        message: "Isolated restore test completed. Production data was not changed.",
        ...result,
      });
    } catch (error) {
      return sendServiceError(res, error, "Unable to run isolated restore test.");
    }
  });

  router.post("/backups/:id/transfer", async (req, res) => {
    try {
      const backup = await backups.transferLegacyBackup({
        backupId: stringValue(req.params.id, 80),
        actor: req.admin,
      });
      return res.json({
        message: "Legacy archive copied to independent storage. The original database copy was kept.",
        backup,
      });
    } catch (error) {
      return sendServiceError(res, error, "Unable to transfer legacy backup.");
    }
  });

  router.post("/backups/upload", (req, res) => {
    upload.single("backup")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || "Unable to accept that file." });
      }
      try {
        const backup = await backups.storeUploadedBackup({
          buffer: req.file?.buffer,
          originalName: req.file?.originalname,
          actor: req.admin,
        });
        await audit(db, req, {
          action: "upload_backup",
          targetType: "backup",
          targetId: backup.id,
          result: "success",
          detail: "Uploaded backup stored without restoring.",
        });
        return res.status(201).json({
          message: "Backup uploaded. Review it, then use Restore if you want to recover from this file.",
          backup,
        });
      } catch (error) {
        await audit(db, req, {
          action: "upload_backup",
          targetType: "backup",
          result: "failed",
          detail: error.message,
        });
        return sendServiceError(res, error, "Unable to store uploaded backup.");
      }
    });
  });

  router.post("/backups/:id/restore", async (req, res) => {
    try {
      const id = stringValue(req.params.id, 80);
      const confirmation = stringValue(req.body?.confirmation, 20);
      const mode = String(req.body?.mode || "isolated").toLowerCase() === "production" ? "production" : "isolated";
      const result = await backups.restoreBackup({
        backupId: id,
        confirmation,
        actor: req.admin,
        createSafety: true,
        mode,
      });
      await audit(db, req, {
        action: mode === "production" ? "restore_backup" : "isolated_restore_backup",
        targetType: "backup",
        targetId: id,
        result: "success",
        detail:
          mode === "production"
            ? `Restored ${result.restoredTables?.length || 0} tables.`
            : "Isolated restore test; production data unchanged.",
      });
      return res.json({
        message:
          mode === "production"
            ? "Database restored and verified from the selected backup."
            : "Isolated restore test completed. Production data was not changed.",
        ...result,
      });
    } catch (error) {
      await audit(db, req, {
        action: "restore_backup",
        targetType: "backup",
        targetId: stringValue(req.params.id, 80),
        result: error.status === 400 || error.status === 403 ? "blocked" : "failed",
        detail: error.message,
      });
      return sendServiceError(res, error, "Unable to restore backup.");
    }
  });

  router.delete("/backups/:id", async (req, res) => {
    try {
      const id = stringValue(req.params.id, 80);
      const result = await backups.deleteBackup({
        backupId: id,
        actor: req.admin,
        confirmation: stringValue(req.body?.confirmation || req.query?.confirmation, 20),
      });
      await audit(db, req, {
        action: "delete_backup",
        targetType: "backup",
        targetId: id,
        result: "success",
        detail: "Backup record deleted.",
      });
      return res.json({ message: "Backup deleted.", ...result });
    } catch (error) {
      return sendServiceError(res, error, "Unable to delete backup.");
    }
  });
}

module.exports = {
  attachAdminBackupRoutes,
};
