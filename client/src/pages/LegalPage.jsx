import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { LegalDocument } from "../components/LegalDocument";
import { legalDocumentById } from "../legal/dentasyncLegal";

export function LegalPage() {
  const location = useLocation();
  const document = legalDocumentById(location.pathname.includes("privacy") ? "privacy" : "terms");
  const other =
    document.id === "privacy"
      ? { to: "/terms", label: "Terms & Conditions" }
      : { to: "/privacy", label: "Privacy Notice" };

  return (
    <main className="legal-page">
      <div className="legal-page__inner">
        <BrandMark />
        <div className="legal-page__nav">
          <Link className="back-button" to="/register">
            <ArrowLeft size={17} /> Back to create account
          </Link>
          <Link className="text-link" to={other.to}>
            {other.label}
          </Link>
        </div>
        <LegalDocument document={document} />
      </div>
    </main>
  );
}
