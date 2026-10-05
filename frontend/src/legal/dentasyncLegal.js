export const LEGAL_EFFECTIVE_DATE = "September 22, 2026";
export const LEGAL_VERSION = "1.0";

export const CLINIC_CONTACT = {
  name: "Amethyst Dental Clinic",
  email: "amethystdental@gmail.com",
  phone: "09109207877",
  address: "Grand Central Residences, Cityland, Sultan St., Highway Hills, Mandaluyong, Metro Manila",
};

export const TERMS_DOCUMENT = {
  id: "terms",
  title: "DentaSync Terms and Conditions",
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    "Welcome to DentaSync, a web-based dental practice management and patient queuing system used by Amethyst Dental Clinic.",
    "By creating an account or using DentaSync, you agree to comply with these Terms and Conditions.",
  ],
  sections: [
    {
      heading: "1. Use of DentaSync",
      paragraphs: [
        "DentaSync is provided to support the clinic’s appointment management, patient records, queuing, notifications, and other authorized clinic operations.",
        "DentaSync does not replace professional dental advice, diagnosis, or treatment provided by a licensed dental professional.",
      ],
    },
    {
      heading: "2. Patient Account",
      paragraphs: [
        "You are responsible for providing accurate information when creating and maintaining your account.",
        "You must not:",
      ],
      bullets: [
        "Create an account using another person’s identity",
        "Provide intentionally false information",
        "Share your password with unauthorized persons",
        "Attempt to access another patient’s account",
        "Attempt to bypass system security controls",
        "Use DentaSync to interfere with the operation of the clinic or system",
      ],
      closing: [
        "You should immediately notify the clinic if you believe that your account has been accessed without authorization.",
      ],
    },
    {
      heading: "3. Appointments and Queue",
      paragraphs: [
        "Appointment and queue information displayed by DentaSync is intended to assist clinic operations.",
        "Actual treatment time and waiting time may change because of emergencies, procedures taking longer than expected, dentist availability, patient arrival times, or other clinic circumstances.",
        "Queue estimates are therefore estimates and are not guaranteed appointment or treatment times.",
      ],
    },
    {
      heading: "4. Patient Records",
      paragraphs: [
        "Information displayed in your patient account is intended for your authorized use.",
        "You must not attempt to access, copy, modify, download, or disclose another person’s dental or personal information without proper authorization.",
      ],
    },
    {
      heading: "5. Notifications",
      paragraphs: [
        "By providing your mobile number, you acknowledge that DentaSync may send service-related notifications, including appointment and queue notifications, as described in the Privacy Notice.",
        "Delivery of SMS or other electronic notifications may depend on telecommunications networks and third-party service providers.",
      ],
    },
    {
      heading: "6. Family and Dependent Accounts",
      paragraphs: [
        "If DentaSync allows you to manage a dependent’s account, you confirm that you have the appropriate authority to manage that person’s information.",
        "You are responsible for using dependent information only for legitimate and authorized purposes.",
      ],
    },
    {
      heading: "7. System Availability",
      paragraphs: [
        "The clinic will make reasonable efforts to keep DentaSync available and functioning properly. However, temporary interruptions may occur because of maintenance, internet connectivity, server problems, telecommunications failures, security incidents, or other circumstances beyond the clinic’s reasonable control.",
      ],
    },
    {
      heading: "8. Prohibited Activities",
      paragraphs: ["Users must not:"],
      bullets: [
        "Attempt unauthorized access to DentaSync",
        "Attempt to obtain another patient’s information",
        "Modify or interfere with system data",
        "Introduce malicious software",
        "Circumvent authentication or authorization controls",
        "Abuse system resources",
        "Use DentaSync for unlawful purposes",
      ],
    },
    {
      heading: "9. Account Suspension or Termination",
      paragraphs: [
        "The clinic may suspend or restrict an account when reasonably necessary to protect the security of DentaSync, protect patient information, investigate suspected unauthorized activity, or comply with applicable laws or clinic policies.",
      ],
    },
    {
      heading: "10. Privacy",
      paragraphs: [
        "The collection and processing of personal information through DentaSync are described in the DentaSync Privacy Notice.",
        "The Privacy Notice forms a separate document from these Terms and Conditions.",
      ],
    },
    {
      heading: "11. Changes to These Terms",
      paragraphs: [
        "The clinic may update these Terms when necessary.",
        "When significant changes affect users, the clinic will provide appropriate notice.",
      ],
    },
    {
      heading: "12. Contact",
      paragraphs: [
        "For questions regarding these Terms and Conditions, please contact:",
        `${CLINIC_CONTACT.name}`,
        `Email: ${CLINIC_CONTACT.email}`,
        `Contact Number: ${CLINIC_CONTACT.phone}`,
        `Clinic Address: ${CLINIC_CONTACT.address}`,
      ],
    },
  ],
};

export const PRIVACY_DOCUMENT = {
  id: "privacy",
  title: "DentaSync Privacy Notice",
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    "Amethyst Dental Clinic respects your privacy and is committed to protecting your personal information. This Privacy Notice explains how your information is collected, used, stored, accessed, and protected when you use the DentaSync Web-Based Dental Practice Management and Patient Queuing System.",
    "By creating an account or using DentaSync, you acknowledge that you have been informed about the processing of your personal information as described in this Privacy Notice.",
  ],
  sections: [
    {
      heading: "1. Information We Collect",
      paragraphs: ["Depending on how you use DentaSync, the system may collect and process:"],
    },
    {
      heading: "Account and Identification Information",
      bullets: [
        "Full name",
        "Date of birth",
        "Sex",
        "Address",
        "Mobile phone number",
        "Email address",
        "Account credentials",
      ],
    },
    {
      heading: "Dental and Health Information",
      bullets: [
        "Dental and medical information relevant to dental care",
        "Dental history",
        "Treatment history",
        "Procedures performed",
        "Appointment information",
        "Dental charts",
        "Relevant dental images or documents submitted to the clinic",
      ],
      closing: [
        "Health information is considered sensitive personal information under the Philippine Data Privacy Act of 2012.",
      ],
    },
    {
      heading: "System and Transaction Information",
      bullets: [
        "Appointment and queue information",
        "Check-in and queue records",
        "Notification records",
        "Account activity and relevant system logs",
      ],
    },
    {
      heading: "2. Purposes of Processing",
      paragraphs: ["Your information may be processed for the following purposes:"],
      bullets: [
        "Creating and maintaining your patient account",
        "Scheduling and managing appointments",
        "Managing patient queues",
        "Confirming patient arrival and check-in",
        "Maintaining accurate dental and treatment records",
        "Providing dental services",
        "Sending appointment reminders and other service-related notifications",
        "Sending queue-related notifications",
        "Managing authorized family or dependent accounts",
        "Generating administrative reports and clinic statistics",
        "Improving the operation, security, and reliability of DentaSync",
        "Processing information required for legitimate clinic operations and applicable legal obligations",
      ],
    },
    {
      heading: "3. Automated Processing and AI-Assisted Features",
      paragraphs: [
        "DentaSync may use automated or AI-assisted functions for specific system purposes, such as estimating queue waiting times or assisting with information extraction from uploaded documents.",
        "Where applicable, these features are intended to assist clinic operations and are not intended to replace the professional judgment of the dentist or other authorized healthcare personnel.",
        "AI-assisted processing will only be used for purposes disclosed by the clinic and will be subject to appropriate security and access controls.",
      ],
    },
    {
      heading: "4. SMS and Notifications",
      paragraphs: [
        "If you provide a mobile phone number, DentaSync may use it to send service-related notifications, such as:",
      ],
      bullets: [
        "Appointment confirmations",
        "Appointment reminders",
        "Queue notifications",
        "Clinic-related updates",
        "Other notifications necessary for the services you request",
      ],
      closing: [
        "SMS messages may be transmitted through an authorized third-party SMS service provider acting as a service provider for the clinic.",
        "DentaSync will not use your mobile number for unrelated marketing purposes unless separately authorized or otherwise permitted by applicable law.",
      ],
    },
    {
      heading: "5. Who May Access Your Information",
      paragraphs: [
        "Access to patient information is restricted according to authorized roles and legitimate clinic functions.",
        "Depending on their role, authorized personnel may include:",
      ],
      bullets: [
        "Authorized clinic administrators",
        "Dentists",
        "Authorized clinic staff",
        "Other personnel specifically authorized by Amethyst Dental Clinic",
      ],
      closing: [
        "Patients may access their own information through their authorized account.",
        "Access to another patient’s information is prohibited unless the person has appropriate authorization, such as an authorized guardian or dependent relationship.",
      ],
    },
    {
      heading: "6. Data Security",
      paragraphs: [
        "Amethyst Dental Clinic and DentaSync will implement reasonable organizational, physical, and technical safeguards intended to protect personal information against unauthorized access, alteration, disclosure, loss, or destruction.",
        "Security measures may include:",
      ],
      bullets: [
        "User authentication",
        "Role-based access control",
        "Password protection",
        "Secure communication",
        "Input validation",
        "Access restrictions",
        "System activity logging",
        "Secure database practices",
        "Backup and recovery procedures",
      ],
      closing: [
        "No electronic system can guarantee absolute security. In the event of a personal data incident, the clinic will follow applicable data-breach response and notification requirements.",
      ],
    },
    {
      heading: "7. Data Retention",
      paragraphs: [
        "Personal information will be retained only for as long as necessary to fulfill the purposes for which it was collected, provide dental services, maintain appropriate patient records, comply with applicable legal requirements, establish or defend legal claims, or fulfill legitimate business purposes.",
        "When information is no longer required and there is no applicable legal or legitimate reason to retain it, it will be securely disposed of or otherwise processed in accordance with applicable requirements.",
        "The clinic will not retain identifiable personal information indefinitely merely for possible future use.",
      ],
    },
    {
      heading: "8. Your Rights as a Data Subject",
      paragraphs: [
        "Subject to applicable law and limitations, you may have rights including:",
      ],
      bullets: [
        "The right to be informed",
        "The right to access your personal information",
        "The right to correct inaccurate or incomplete information",
        "The right to object to certain processing",
        "The right to request erasure or blocking under applicable circumstances",
        "The right to data portability where applicable",
        "The right to file a complaint",
        "The right to damages where provided by law",
      ],
      closing: [
        "Requests concerning your personal information may be submitted through the clinic’s designated privacy contact.",
      ],
    },
    {
      heading: "9. Children’s and Dependent Accounts",
      paragraphs: [
        "Where a patient is a minor or another person is legally authorized to manage the patient’s information, the clinic may process information through an authorized parent, guardian, or representative in accordance with applicable law.",
        "The person creating or managing a dependent account must have the appropriate authority to do so.",
      ],
    },
    {
      heading: "10. Changes to This Privacy Notice",
      paragraphs: [
        "Amethyst Dental Clinic may update this Privacy Notice when necessary because of changes to DentaSync, clinic operations, applicable laws, regulations, or data-processing activities.",
        "When a significant change affects how personal information is processed, affected data subjects will be appropriately informed and, where required, given an opportunity to exercise applicable rights.",
      ],
    },
    {
      heading: "11. Privacy Contact",
      paragraphs: [
        "For questions, requests, or concerns regarding the processing of your personal information, please contact:",
        `${CLINIC_CONTACT.name}`,
        "Privacy Contact / Data Protection Officer: Amethyst Dental Clinic",
        `Email: ${CLINIC_CONTACT.email}`,
        `Contact Number: ${CLINIC_CONTACT.phone}`,
        `Clinic Address: ${CLINIC_CONTACT.address}`,
      ],
    },
  ],
};

export function legalDocumentById(id) {
  return id === "privacy" ? PRIVACY_DOCUMENT : TERMS_DOCUMENT;
}
