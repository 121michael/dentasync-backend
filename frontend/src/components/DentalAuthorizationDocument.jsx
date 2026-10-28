function valueOrDash(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

function formatLongDate(value) {
  if (!value) return "—";
  const raw = String(value);
  const day = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00`) : new Date(day);
  if (Number.isNaN(date.getTime())) return valueOrDash(value);
  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return valueOrDash(value);
  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status) {
  const map = {
    draft: "Draft — not signed",
    awaiting_signature: "Awaiting patient signature",
    signed: "Signed",
    superseded: "Superseded",
    voided: "Voided",
  };
  return map[status] || valueOrDash(status);
}

export function DentalAuthorizationDocument({ document, clinic }) {
  if (!document) return null;
  const clinicName = clinic?.name || "Amethyst Dental Clinic";
  const contact = [clinic?.address, clinic?.phone, clinic?.email].filter(Boolean).join("  ·  ");

  return (
    <article className="dental-auth-page" aria-label="Dental procedure authorization">
      <header className="dental-auth-page__header">
        <p className="dental-auth-page__clinic">{clinicName}</p>
        {contact ? <p className="dental-auth-page__contact">{contact}</p> : null}
        {clinic?.operatingHours ? <p className="dental-auth-page__contact">{clinic.operatingHours}</p> : null}
        <h1>Authorization and Informed Consent for Dental Procedure</h1>
        <p className="dental-auth-page__meta">Document No. {valueOrDash(document.documentNumber)}</p>
      </header>

      <section>
        <h2>Patient information</h2>
        <dl className="dental-auth-page__grid">
          <div>
            <dt>Full name</dt>
            <dd>{valueOrDash(document.patientFullName)}</dd>
          </div>
          <div>
            <dt>Patient ID</dt>
            <dd>{valueOrDash(document.patientClinicId)}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{formatLongDate(document.patientDateOfBirth)}</dd>
          </div>
          <div>
            <dt>Age</dt>
            <dd>{valueOrDash(document.patientAge)}</dd>
          </div>
          <div>
            <dt>Contact number</dt>
            <dd>{valueOrDash(document.patientPhone)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>Dental procedure information</h2>
        <dl className="dental-auth-page__grid">
          <div>
            <dt>Procedure / treatment</dt>
            <dd>{valueOrDash(document.procedureName)}</dd>
          </div>
          <div>
            <dt>Tooth number / treatment area</dt>
            <dd>{valueOrDash(document.toothOrArea)}</dd>
          </div>
          <div>
            <dt>Treating dentist</dt>
            <dd>{valueOrDash(document.treatingDentist || document.dentistName)}</dd>
          </div>
          <div>
            <dt>Planned procedure date</dt>
            <dd>{formatLongDate(document.plannedProcedureDate)}</dd>
          </div>
        </dl>
        {document.clinicalNotes ? (
          <>
            <p className="dental-auth-page__label">Relevant clinical notes</p>
            <p>{document.clinicalNotes}</p>
          </>
        ) : null}
      </section>

      <section>
        <h2>Explanation and consent</h2>
        <p className="dental-auth-page__label">Proposed procedure</p>
        <p>{document.explanation}</p>
        <p className="dental-auth-page__label">Expected benefits</p>
        <p>{document.expectedBenefits}</p>
        <p className="dental-auth-page__label">Material risks</p>
        <p>{document.materialRisks}</p>
        <p className="dental-auth-page__label">Relevant alternatives</p>
        <p>{document.alternatives}</p>
        <p className="dental-auth-page__label">Questions</p>
        <p>{document.questionsOpportunity}</p>
        <p className="dental-auth-page__label">Voluntary authorization</p>
        <p>{document.voluntaryAuthorization}</p>
        <p className="dental-auth-page__label">Withdrawal of consent</p>
        <p>{document.withdrawalStatement}</p>
        <p className="dental-auth-page__label">Confirmation of understanding</p>
        <p>{document.understandingConfirmation}</p>
      </section>

      <section className="dental-auth-page__signs">
        <h2>Signatures</h2>
        <div className="dental-auth-sign">
          <strong>Patient or authorized representative</strong>
          <span className="dental-auth-sign__line" />
          <small>
            {document.patientOrRepresentativeName
              ? `${document.patientOrRepresentativeName}${
                  document.representativeRelationship ? ` · ${document.representativeRelationship}` : ""
                } · ${formatDateTime(document.patientSignedAt)}`
              : "Signature / printed name / date"}
          </small>
        </div>
        <div className="dental-auth-sign">
          <strong>Treating dentist</strong>
          <span className="dental-auth-sign__line" />
          <small>
            {document.dentistName
              ? `${document.dentistName} · ${formatDateTime(document.dentistSignedAt)}`
              : "Signature / printed name / date"}
          </small>
        </div>
        <div className="dental-auth-sign">
          <strong>Witness or guardian (if applicable)</strong>
          <span className="dental-auth-sign__line" />
          <small>
            {[document.witnessName && `Witness: ${document.witnessName}`, document.guardianName && `Guardian: ${document.guardianName}`]
              .filter(Boolean)
              .join(" · ") || "Name / relationship / date"}
          </small>
        </div>
      </section>

      <section>
        <h2>Recordkeeping</h2>
        <dl className="dental-auth-page__grid">
          <div>
            <dt>Document status</dt>
            <dd>{statusLabel(document.status)}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{document.version || 1}</dd>
          </div>
          <div>
            <dt>Consent date / time</dt>
            <dd>{formatDateTime(document.consentRecordedAt || document.patientSignedAt)}</dd>
          </div>
          <div>
            <dt>Upload date</dt>
            <dd>{formatDateTime(document.uploadedAt)}</dd>
          </div>
        </dl>
        <p className="dental-auth-page__notice">
          This is a clinic template for recordkeeping. It is not a substitute for a dentist-to-patient
          discussion of procedure-specific risks and alternatives. The responsible dentist, and any
          required legal adviser, must review this wording before it is used with patients. Generating
          or uploading this form does not, by itself, constitute legally sufficient informed consent.
        </p>
      </section>
    </article>
  );
}

export { statusLabel };
