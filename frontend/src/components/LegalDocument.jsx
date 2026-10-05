export function LegalDocument({ document }) {
  if (!document) return null;

  return (
    <article className="legal-document">
      <header className="legal-document__header">
        <h1>{document.title}</h1>
        <p>
          Effective Date: {document.effectiveDate}
          <span aria-hidden="true"> · </span>
          Version: {document.version}
        </p>
      </header>
      {document.intro?.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {document.sections.map((section) => (
        <section key={section.heading} className="legal-document__section">
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets?.length ? (
            <ul>
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.closing?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="legal-document__version">
        {document.id === "privacy" ? "Privacy Notice" : "Terms"} Version: {document.version}
      </p>
    </article>
  );
}
