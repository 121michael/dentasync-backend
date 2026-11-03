"use strict";

const { createS3CompatMock } = require("../services/s3CompatMock");

const port = Number(process.env.BACKUP_S3_MOCK_PORT || 9099);
const bucket = process.env.BACKUP_S3_BUCKET || "dentasync-backups";

createS3CompatMock({ bucket })
  .listen(port)
  .then(({ url }) => {
    console.log(`S3-compatible mock listening at ${url}/${bucket}`);
    console.log("Use BACKUP_S3_ENDPOINT=" + url);
  });
