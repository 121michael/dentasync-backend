import { DentistModal } from "./DentistUI";

function previewKind(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("jpeg") || mime.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image";
  }
  if (mime.includes("png") || name.endsWith(".png")) return "image";
  return null;
}

export function DentalDocumentPreview({ document, objectUrl, error, onClose, onDownload }) {
  if (!document) return null;
  const kind = previewKind(document.mimeType, document.filename || document.name);
  const title = document.name || document.filename || "Dental document";

  return (
    <DentistModal
      wide
      stacked
      closeOnEscape
      className="dental-doc-preview"
      title={title}
      onClose={onClose}
    >
      {error ? (
        <p className="inline-alert inline-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {!error && kind === "image" && objectUrl ? (
        <img className="dental-doc-preview__image" src={objectUrl} alt={title} />
      ) : null}
      {!error && kind === "pdf" && objectUrl ? (
        <iframe
          className="dental-doc-preview__frame"
          title={title}
          src={objectUrl}
        />
      ) : null}
      {!error && !kind ? (
        <p className="muted-copy">
          This file type cannot be previewed in the portal. Use Download to save a copy.
        </p>
      ) : null}
      <div className="dental-docs-actions dental-docs-actions--preview">
        <button type="button" className="button button--secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="button button--secondary" onClick={onDownload}>
          Download
        </button>
      </div>
    </DentistModal>
  );
}
