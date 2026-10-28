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
      if (row.status !== "success" || !row.payload) {
        return res.status(400).json({ message: "Only a completed backup can be downloaded." });
      }
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
      return res.send(row.payload);
    } catch (error) {
      return sendServiceError(res, error, "Unable to download backup.");
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
      const result = await backups.restoreBackup({
        backupId: id,
        confirmation,
        actor: req.admin,
        createSafety: true,
      });
      await audit(db, req, {
        action: "restore_backup",
        targetType: "backup",
        targetId: id,
        result: "success",
        detail: `Restored ${result.restoredTables.length} tables.`,
      });
      return res.json({
        message: "Database restored and verified from the selected backup.",
        ...result,
      });
    } catch (error) {
      await audit(db, req, {
        action: "restore_backup",
        targetType: "backup",
        targetId: stringValue(req.params.id, 80),
        result: error.status === 400 ? "blocked" : "failed",
        detail: error.message,
      });
      return sendServiceError(res, error, "Unable to restore backup.");
    }
  });

  router.delete("/backups/:id", async (req, res) => {
    try {
      const id = stringValue(req.params.id, 80);
      const result = await backups.deleteBackup({ backupId: id, actor: req.admin });
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
