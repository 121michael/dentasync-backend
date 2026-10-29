"use strict";

/**
 * Patient-facing clinic assistant.
 * Grounds answers in Amethyst Dental clinic facts and general oral-health education.
 * Understands English, Filipino/Tagalog, and Taglish; replies in the patient's language.
 * Does not diagnose conditions or prescribe treatment.
 * Optional Gemini is used only when GEMINI_API_KEY is set, still grounded in clinic facts.
 */

const DEFAULT_CLINIC = {
  name: "Amethyst Dental Clinic",
  address: "Makati, Metro Manila",
  phone: "+63 2 8555 1234",
  email: "care@amethystdental.example",
  operatingHours: "Monday–Friday 9:00 AM–4:00 PM · Saturday–Sunday and holidays 11:00 AM–4:00 PM",
};

// Clinic-approved HMO catalog. Update this list (and aliases) to change chatbot answers without retraining Gemini.
const APPROVED_HMO_PROVIDERS = [
  { id: "maxicare", name: "Maxicare", aliases: ["maxicare"], filipinoDoctors: false },
  { id: "icare", name: "iCare", aliases: ["icare", "i care"], filipinoDoctors: true },
  { id: "pacific-cross", name: "Pacific Cross", aliases: ["pacific cross", "pacificcross"], filipinoDoctors: true },
  { id: "etiqa", name: "Etiqa", aliases: ["etiqa"], filipinoDoctors: true },
  { id: "lacson", name: "Lacson & Lacson", aliases: ["lacson", "lacson & lacson", "lacson and lacson"], filipinoDoctors: true },
  { id: "hppi", name: "HPPI", aliases: ["hppi"], filipinoDoctors: true },
  { id: "flexicare", name: "Flexicare", aliases: ["flexicare", "flexi care"], filipinoDoctors: true },
  { id: "cocolife", name: "Cocolife", aliases: ["cocolife", "coco life"], filipinoDoctors: false },
  { id: "valucare", name: "ValuCare", aliases: ["valucare", "valuecare", "valu care", "value care"], filipinoDoctors: false },
];

const UNLISTED_HMO_HINTS = [
  "medicard",
  "intellicare",
  "philhealth",
  "phil health",
  "caritas",
  "avega",
  "insular",
  "generali",
  "blue cross",
  "medicare",
];

function formatHmoProviderList(providers = APPROVED_HMO_PROVIDERS) {
  const names = providers.map((item) => item.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const HMO_PROVIDER_LIST = formatHmoProviderList();

const HMO_PRIVACY_EN =
  "Your HMO information will be used for verification purposes only, to help the clinic check your account and eligibility for dental services. Your information will be handled in accordance with our privacy policy and applicable data protection requirements.";

const HMO_PRIVACY_TL =
  "Gagamitin ang iyong HMO information para sa verification lamang, upang matulungan ang klinika na i-check ang iyong account at eligibility para sa dental services. Hahawakan ito ayon sa aming privacy policy at applicable data protection requirements.";

const HMO_DEFAULT_EN = `Amethyst Dental Clinic accommodates patients with ${HMO_PROVIDER_LIST}, subject to account verification, applicable accreditation arrangements, and coverage.

Please book an appointment and follow our clinic's HMO verification process. Our clinic staff must confirm your account eligibility and the coverage available for your requested dental service before we can confirm whether it is covered.

${HMO_PRIVACY_EN}`;

const HMO_DEFAULT_TL = `Tumanggap ang Amethyst Dental Clinic ng pasyente na may ${HMO_PROVIDER_LIST}, subject sa account verification, applicable accreditation arrangements, at coverage.

Mag-book ng appointment at sundan ang HMO verification process ng klinika. Kailangang kumpirmahin ng clinic staff ang eligibility ng account at ang coverage para sa hinihinging dental service bago namin masabing covered ito.

${HMO_PRIVACY_TL}`;

const { resolveCatalog } = require("./approvedClinicCatalog");

const DEFAULT_RESOLVED_CATALOG = resolveCatalog(null);
const APPROVED_CLINIC_SERVICES = DEFAULT_RESOLVED_CATALOG.chatbotServices;
const APPROVED_SERVICE_FACTS_EN = DEFAULT_RESOLVED_CATALOG.factsEn;
const APPROVED_SERVICE_FACTS_TL = DEFAULT_RESOLVED_CATALOG.factsTl;
const GENERIC_SERVICE_TOKENS = new Set([
  "dental",
  "teeth",
  "tooth",
  "oral",
  "care",
  "clinic",
  "klinika",
  "ngipin",
  "general",
  "permanent",
  "fixed",
  "treatment",
  "consultation",
]);

const TAGALOG_MARKERS = [
  "po",
  "opo",
  "hindi",
  "salamat",
  "anong",
  "ano ang",
  "ano po",
  "kailan",
  "saan",
  "nasaan",
  "paano",
  "bakit",
  "pwede",
  "pwede ba",
  "pwedeng",
  "puwede",
  "gusto ko",
  "kailangan",
  "ngipin",
  "mga ngipin",
  "gilagid",
  "dentista",
  "klinika",
  "magkano",
  "pila",
  "sipilyo",
  "magsipilyo",
  "magsisipilyo",
  "bunot",
  "pustiso",
  "magpatingin",
  "maglinis",
  "pampaputi",
  "magpabraces",
  "magpapasta",
  "masakit",
  "sakit ng",
  "ngilo",
  "tawag",
  "tumawag",
  "serbisyo",
  "iskedyul",
  "kanselahin",
  "lokasyon",
  "telepono",
  "hininga",
  "dumudugo",
  "pamamaga",
  "unang ngipin",
];

const SERVICE_ALIASES = [
  {
    id: "cleaning",
    terms: [
      "cleaning",
      "prophylaxis",
      "oral prophylaxis",
      "hygiene",
      "oral prophy",
      "magpacleaning",
      "magpa-cleaning",
      "paglilinis sa klinika",
    ],
  },
  {
    id: "extraction",
    terms: ["extraction", "extract", "pull a tooth", "pulling a tooth", "bunot", "magpabunot", "pagbunot"],
  },
  {
    id: "filling",
    terms: [
      "filling",
      "restoration",
      "cavity filling",
      "composite",
      "magpapasta",
      "pasta sa ngipin",
      "pasta ng ngipin",
    ],
  },
  { id: "root-canal", terms: ["root canal", "endodontic", "endo", "root canal treatment"] },
  {
    id: "orthodontic-consultation",
    terms: ["braces", "ortho", "orthodontic", "aligner", "invisalign", "magpabraces", "braces ko"],
  },
  {
    id: "whitening",
    terms: ["whitening", "whiten", "bleaching", "pampaputi", "paputiin", "puting ngipin"],
  },
  {
    id: "general-consultation",
    terms: [
      "consultation",
      "checkup",
      "check up",
      "examination",
      "exam",
      "magpatingin",
      "patingin",
      "konsulta",
    ],
  },
  { id: "odontectomy", terms: ["odontectomy", "wisdom tooth removal"] },
  { id: "frenectomy", terms: ["frenectomy"] },
  { id: "ortho-adjustment", terms: ["ortho adjustment", "orthodontic adjustment"] },
  {
    id: "dentures",
    terms: ["denture", "dentures", "pustiso"],
  },
  {
    id: "fixed-bridge",
    terms: ["fixed bridge", "dental bridge", "bridge"],
  },
  {
    id: "dental-crowns",
    terms: ["dental crown", "dental crowns", "crown", "crowns", "cap", "korona"],
  },
  {
    id: "veneers",
    terms: ["veneer", "veneers"],
  },
  {
    id: "dental-implants",
    terms: ["implant", "implants", "dental implant", "dental implants"],
  },
  {
    id: "gum-contouring",
    terms: ["gum contouring", "gum contour", "gingivoplasty"],
  },
];

const CLINIC_TOPICS = [
  {
    id: "hours",
    keywords: [
      "hours",
      "open",
      "opens",
      "close",
      "closes",
      "closing",
      "operating hours",
      "clinic hours",
      "business hours",
      "what time do you",
      "until what time",
      "oprating hours",
      "opning hours",
      "clinic hour",
      "oras bukas",
      "oras ng klinika",
      "oras ng clinic",
      "anong oras kayo",
      "anong oras ang klinika",
      "kailan bukas",
      "kailan kayo bukas",
      "bukas ba",
      "sarado ba",
      "sarado",
      "anong oras kayo nag oopen",
    ],
    build: (clinic, _dentists, _services, lang) => {
      const today = clinic.todayHoursLabel
        ? pick(lang, `Today: ${clinic.todayHoursLabel}. `, `Ngayon: ${clinic.todayHoursLabel}. `)
        : "";
      return pick(
        lang,
        `${today}${clinic.name} is open ${clinic.operatingHours}. Appointments are booked from the Appointments page. Portal messages are reviewed during clinic hours.`,
        `${today}Bukas ang ${clinic.name} ayon sa iskedyul: ${clinic.operatingHours}. Mag-book ng appointment sa page na Appointments. Sinusuri ang mga mensahe sa portal sa oras ng klinika.`
      );
    },
  },
  {
    id: "location",
    keywords: [
      "location",
      "address",
      "where",
      "makati",
      "branch",
      "clinic location",
      "how to get there",
      "saan",
      "nasaan",
      "lokasyon",
      "address ng klinika",
      "saan kayo",
      "saan ang klinika",
      "saan ang clinic",
    ],
    build: (clinic, _dentists, _services, lang) =>
      pick(
        lang,
        `${clinic.name} is at ${clinic.address}. Confirm the location on your appointment details if staff has noted a different visit site.`,
        `Nasa ${clinic.address} ang ${clinic.name}. Tingnan ang detalye ng appointment kung may ibang lokasyon na nakalagay mula sa staff.`
      ),
  },
  {
    id: "contact",
    keywords: [
      "phone",
      "call",
      "email",
      "contact",
      "reach",
      "hotline",
      "number",
      "tawag",
      "tumawag",
      "telepono",
      "numero",
      "contact number",
    ],
    build: (clinic, _dentists, _services, lang) =>
      pick(
        lang,
        `You can call ${clinic.name} at ${clinic.phone} or email ${clinic.email}. For a dental emergency during clinic hours, call the clinic directly.`,
        `Tumawag sa ${clinic.name} sa ${clinic.phone} o mag-email sa ${clinic.email}. Kung emergency sa ngipin habang bukas ang klinika, tumawag mismo sa clinic.`
      ),
  },
  {
    id: "hmo",
    keywords: [
      "hmo",
      "insurance",
      "coverage",
      "maxicare",
      "icare",
      "pacific cross",
      "etiqa",
      "lacson",
      "hppi",
      "flexicare",
      "cocolife",
      "valucare",
      "valuecare",
      "philhealth",
      "medicard",
      "accreditation",
    ],
    build: (_clinic, _dentists, _services, lang) => pick(lang, HMO_DEFAULT_EN, HMO_DEFAULT_TL),
  },
  {
    id: "queue",
    keywords: [
      "queue",
      "wait",
      "check-in",
      "check in",
      "rfid",
      "qr",
      "token",
      "now serving",
      "pila",
      "pila ba",
      "check in",
    ],
    build: (_clinic, _dentists, _services, lang) =>
      pick(
        lang,
        "After your appointment is confirmed, open Queue Status in the patient portal, or check in with staff using your RFID card or the clinic QR code. Daily queue numbers look like A-001 (regular), S-001 (senior), P-001 (pediatric), or W-001 (PWD) and restart each clinic day. Your number, status, and estimated wait (when available) appear on Queue Status. If check-in fails, ask the front desk — I cannot check you in from chat.",
        "Kapag confirmed na ang appointment, buksan ang Queue Status sa patient portal, o mag-check in sa staff gamit ang RFID o QR ng klinika. Ang daily queue number ay parang A-001 (regular), S-001 (senior), P-001 (pediatric), o W-001 (PWD) at nagtatapos bawat araw. Makikita ang numero, status, at estimated wait (kung meron) sa Queue Status. Kung hindi mag-check in, tanungin ang front desk — hindi kita ma-check in mula sa chat."
      ),
  },
  {
    id: "booking",
    keywords: [
      "book",
      "booking",
      "appointment",
      "appoinment",
      "schedule a visit",
      "available slot",
      "availability",
      "reserve",
      "mag-book",
      "magbook",
      "magpa-appoint",
      "magpaappoint",
      "iskedyul",
      "sched",
    ],
    build: (_clinic, _dentists, _services, lang) =>
      pick(
        lang,
        "Book from Appointments in the patient portal. Choose a service, date, and an open time shown there, then submit for clinic confirmation. Open slots are only those listed on Appointments — I cannot invent availability or complete a booking in chat. You do not pick a dentist; the clinic assigns an available clinician for that slot.",
        "Mag-book sa Appointments sa patient portal. Pumili ng serbisyo, petsa, at bukas na oras na makikita doon, tapos i-submit para sa confirmation ng klinika. Ang open slots ay ang naka-lista sa Appointments lang — hindi ako makakaimbento ng availability o makakapag-book sa chat. Hindi ka pumipili ng dentist; ang clinic ang mag-a-assign ng available na clinician sa slot na iyon."
      ),
  },
  {
    id: "cancel",
    keywords: [
      "cancel",
      "reschedule",
      "change appointment",
      "move my appointment",
      "kanselahin",
      "i-cancel",
      "i-reschedule",
      "palitan ang appointment",
    ],
    build: (_clinic, _dentists, _services, lang) =>
      pick(
        lang,
        "Pending or confirmed appointments can be cancelled from Appointments. To reschedule, cancel the visit or contact the front desk so staff can update the booking.",
        "Pwede mong kanselahin ang pending o confirmed na appointment sa Appointments. Para mag-reschedule, i-cancel ang bisita o tawagan ang front desk para ma-update ng staff ang booking."
      ),
  },
  {
    id: "dentists",
    keywords: [
      "our dentist",
      "clinic dentist",
      "dentists",
      "orthodontist",
      "who are the doctors",
      "doctors at the clinic",
      "specialist at",
      "mga dentista",
      "dentista",
      "mga doktor",
      "sino ang dentista",
      "sino ang doktor",
    ],
    build: (_clinic, dentists, _services, lang) => {
      if (!dentists.length) {
        return pick(
          lang,
          "Amethyst Dental assigns an available dentist when you book. You can review assigned clinician details on your appointment after confirmation.",
          "Nag-a-assign ang Amethyst Dental ng available na dentist kapag nag-book ka. Makikita ang assigned clinician sa appointment pagkatapos ma-confirm."
        );
      }
      const list = dentists
        .map((dentist) => `${dentist.name}${dentist.specialty ? ` (${dentist.specialty})` : ""}`)
        .join("; ");
      return pick(
        lang,
        `The clinic team includes ${list}. Patients book a service and time; the clinic assigns an available dentist for that slot.`,
        `Kasama sa team ng klinika sina ${list}. Nagbu-book ang pasyente ng serbisyo at oras; ang clinic ang mag-a-assign ng available na dentist sa slot na iyon.`
      );
    },
  },
  {
    id: "services",
    keywords: [
      "services",
      "treatments",
      "what do you offer",
      "procedures",
      "price",
      "cost",
      "fee",
      "how much",
      "serbisyo",
      "mga serbisyo",
      "anong services",
      "anong serbisyo",
      "magkano",
      "presyo",
      "bayad",
      "gastos",
    ],
    build: (_clinic, _dentists, _services, lang, extras = {}) =>
      pick(
        lang,
        `${extras.factsEn || APPROVED_SERVICE_FACTS_EN} Listed fees and case-based costs are confirmed at a FREE consultation / oral examination. Mag-book sa Appointments.`,
        `${extras.factsTl || APPROVED_SERVICE_FACTS_TL} Mag-book ng FREE consultation / oral examination. Mag-book sa Appointments.`
      ),
  },
  {
    id: "emergency",
    keywords: [
      "emergency",
      "urgent",
      "severe pain",
      "swelling",
      "bleeding that will not stop",
      "matinding sakit",
      "malubhang sakit",
      "pamamaga",
      "hindi tumitigil ang pagdurugo",
    ],
    build: (clinic, _dentists, _services, lang) =>
      pick(
        lang,
        `For urgent dental pain or swelling during clinic hours, call ${clinic.name} at ${clinic.phone}. The clinic does not offer Emergency Dental Care as a bookable service. This assistant cannot diagnose emergencies — seek in-person care for severe symptoms.`,
        `Kung matindi ang sakit ng ngipin o may pamamaga habang bukas ang klinika, tumawag sa ${clinic.name} sa ${clinic.phone}. Hindi nag-aalok ang klinika ng Emergency Dental Care bilang bookable na serbisyo. Hindi makakapag-diagnose ang assistant na ito — magpatingin mismo kung malala ang sintomas.`
      ),
  },
  {
    id: "account",
    keywords: [
      "register",
      "registration",
      "verify account",
      "verification code",
      "otp",
      "sign up",
      "create account",
      "password",
      "forgot password",
      "reset password",
      "cannot login",
      "can't log in",
      "family",
      "dependent",
      "dependents",
      "anak",
      "my profile",
      "dental record",
      "patient portal",
      "mag-register",
      "magregister",
      "password ko",
    ],
    build: (clinic, _dentists, _services, lang) =>
      pick(
        lang,
        `Create an account from Register, then complete email OTP verification before signing in. Reset a forgotten password from Forgot password on the login page. Add family members from Family; clinic admin must approve a dependent before they can be used. Update personal details in My Profile. This chat cannot reset passwords or approve dependents — contact ${clinic.name} at ${clinic.phone} or the front desk if you are locked out.`,
        `Gumawa ng account sa Register, tapos tapusin ang email OTP verification bago mag-sign in. I-reset ang nakalimutang password sa Forgot password sa login page. Magdagdag ng kapamilya sa Family; kailangan ng approval ng admin bago magamit ang dependent. I-update ang detalye sa My Profile. Hindi makakapag-reset ng password o mag-approve ng dependent ang chat — tumawag sa ${clinic.name} sa ${clinic.phone} o sa front desk kung naka-lock out ka.`
      ),
  },
];

const ORAL_HEALTH_TOPICS = [
  {
    keywords: [
      "brush",
      "brushing",
      "toothpaste",
      "how to brush",
      "sipilyo",
      "magsipilyo",
      "magsisipilyo",
      "maglinis ng ngipin",
      "linisin ang ngipin",
      "linis ng ngipin",
    ],
    en: "Brush twice a day for about two minutes with a soft-bristled brush and fluoride toothpaste. Angle the bristles toward the gumline and clean every outer, inner, and chewing surface. Replace your brush every 3 months, or sooner if the bristles fray. This is general oral-care information, not a diagnosis.",
    tl: "Magsipilyo ng dalawang beses sa isang araw, mga dalawang minuto, gamit ang malambot na sipilyo at fluoride toothpaste. Ihakbang ang bristles palapit sa gilagid at linisin ang labas, loob, at ngumunguya na parte. Palitan ang sipilyo tuwing 3 buwan, o mas maaga kung sira na ang bristles. Pangkalahatang payo sa oral care ito, hindi diagnosis.",
  },
  {
    keywords: ["floss", "flossing", "interdental", "dental floss"],
    en: "Floss once daily to clean between teeth where a brush cannot reach. Slide the floss gently to the gumline, curve it around each tooth, and avoid snapping it into the gums. Interdental brushes can help if recommended by your dentist. This is general information only.",
    tl: "Mag-floss isang beses araw-araw para linisin ang pagitan ng ngipin na hindi abot ng sipilyo. Dahan-dahang idaan ang floss sa gilagid, iikot sa bawat ngipin, at huwag igagaod papunta sa gilagid. Puwedeng tumulong ang interdental brush kung inirekomenda ng dentista. Pangkalahatang impormasyon lang ito.",
  },
  {
    keywords: [
      "cavity",
      "cavities",
      "decay",
      "caries",
      "hole in tooth",
      "butas sa ngipin",
      "butas ang ngipin",
      "bulok",
      "nabubulok",
    ],
    en: "Tooth decay happens when plaque acids wear enamel. Common prevention is brushing with fluoride toothpaste, daily flossing, limiting sugary snacks and drinks, and routine cleanings. A dark spot, hole, or lingering toothache needs an in-person exam — this assistant cannot diagnose a cavity or decide if you need a filling.",
    tl: "Nangyayari ang tooth decay kapag kinakain ng asido mula sa plaque ang enamel. Karaniwang proteksyon: magsipilyo ng fluoride toothpaste, mag-floss araw-araw, bawasan ang matatamis, at magpa-cleaning. Kung may madilim na mantsa, butas, o tuloy-tuloy na sakit, kailangan ng personal na exam — hindi makakapag-diagnose ng cavity o magdesisyon kung kailangan ng pasta ang assistant na ito.",
  },
  {
    keywords: [
      "gum",
      "gums",
      "gingivitis",
      "periodontal",
      "bleeding gum",
      "gilagid",
      "dumudugo ang gilagid",
      "dumudugo gilagid",
    ],
    en: "Healthy gums are typically pink and firm. Bleeding while brushing can be a sign of gum inflammation from plaque. Gentle brushing, daily flossing, and professional cleanings help. Persistent bleeding, swelling, or loose teeth should be checked by a dentist. This is not a diagnosis.",
    tl: "Karaniwang pink at matatag ang malusog na gilagid. Ang pagdurugo habang nagsisipilyo ay maaaring senyales ng pamamaga dahil sa plaque. Tumutulong ang mahinang pagsisipilyo, araw-araw na floss, at professional cleaning. Kung tuloy-tuloy ang pagdurugo, pamamaga, o maluwag ang ngipin, ipatingin sa dentista. Hindi ito diagnosis.",
  },
  {
    keywords: [
      "sensitive",
      "sensitivity",
      "hurt when i drink",
      "cold water",
      "ngilo",
      "nangingilo",
      "sensitibo ang ngipin",
    ],
    en: "Tooth sensitivity to cold, heat, or sweets is common and can come from worn enamel, exposed roots, or a cracked filling. A desensitizing toothpaste and a dental exam can help identify the cause. Avoid guessing home treatments for sharp or lingering pain — see your dentist.",
    tl: "Karaniwan ang ngilo sa lamig, init, o matamis, at puwedeng galing sa pagkasira ng enamel, nakalitaw na ugat, o basag na pasta. Makakatulong ang desensitizing toothpaste at dental exam para alamin ang dahilan. Huwag hulaan ang gamot sa bahay kung matalim o tuloy-tuloy ang sakit — magpatingin sa dentista.",
  },
  {
    keywords: ["wisdom", "third molar", "wisdom tooth", "wisdom teeth", "ngiping wisdom"],
    en: "Wisdom teeth are the third molars at the back of the mouth. They may erupt normally, stay under the gum, or come in at an angle. Only a dentist can tell from an exam and X-rays whether they need to stay or be removed. Book an oral examination if they hurt, swell, or are hard to clean.",
    tl: "Ang wisdom teeth ay ang third molars sa likod ng bibig. Puwedeng tumubo nang maayos, manatili sa ilalim ng gilagid, o tumagilid. Dentista lang, mula sa exam at X-ray, ang makapagsasabi kung kailangang bunutin. Magpa-exam kung masakit, namamaga, o mahirap linisin.",
  },
  {
    keywords: [
      "tooth number",
      "fdi",
      "which tooth",
      "molar",
      "incisor",
      "canine",
      "premolar",
      "adult teeth",
      "baby teeth",
      "pangil",
      "ngipin ng bata",
      "mga ngipin ng adulto",
    ],
    en: "Adults typically have 32 permanent teeth: incisors at the front, canines, premolars, and molars at the back, including wisdom teeth. Dentists often use FDI numbers (upper right 11–18, upper left 21–28, lower left 31–38, lower right 41–48). Children have 20 primary teeth. This assistant can explain tooth names, not diagnose a specific tooth problem.",
    tl: "Karaniwang 32 ang permanenteng ngipin ng adulto: incisors sa harap, canine, premolar, at molar sa likod, kasama ang wisdom teeth. Madalas gumamit ang dentista ng FDI numbers (upper right 11–18, upper left 21–28, lower left 31–38, lower right 41–48). May 20 primary teeth ang mga bata. Maipapaliwanag ng assistant ang pangalan ng ngipin, hindi ang diagnosis ng isang tiyak na problema.",
  },
  {
    keywords: [
      "enamel",
      "anatomy",
      "pulp",
      "root of the tooth",
      "what is a tooth",
      "ugat ng ngipin",
      "ano ang ngipin",
    ],
    en: "A tooth has enamel on the outside, dentin underneath, and a pulp chamber with nerves and blood vessels. Roots anchor the tooth in the jaw. Protect enamel with fluoride, limited acidic drinks, and regular checkups. Pain that lasts, swelling, or a broken tooth needs a dentist visit.",
    tl: "May enamel sa labas ang ngipin, dentin sa ilalim, at pulp chamber na may ugat at daluyan ng dugo. Nakaangkla ang ugat sa panga. Protektahan ang enamel gamit ang fluoride, limitadong maasim na inumin, at regular na checkup. Kung tuloy-tuloy ang sakit, may pamamaga, o bali ang ngipin, magpatingin sa dentista.",
  },
  {
    keywords: ["braces care", "wax", "elastics", "retainers", "alaga sa braces", "retainer"],
    en: "If you wear braces, brush after meals, use floss threaders or interdental brushes, and avoid very sticky or hard foods. Orthodontic wax can ease rubbing wires. After braces, retainers keep teeth from shifting — wear them as instructed. For adjustments or broken brackets, contact the clinic rather than trying to fix them yourself.",
    tl: "Kung may braces, magsipilyo pagkatapos kumain, gumamit ng floss threader o interdental brush, at iwasan ang malagkit o napakatigas na pagkain. Nakakatulong ang orthodontic wax sa kumakiskis na alambre. Pagkatapos ng braces, pinipigilan ng retainer ang paggalaw ng ngipin — suotin ayon sa bilin. Para sa adjustment o sirang bracket, tawagan ang klinika, huwag ayusin mag-isa.",
  },
  {
    keywords: [
      "after extraction",
      "dry socket",
      "post op",
      "after surgery",
      "pagkatapos ng bunot",
      "pagkatapos magpabunot",
      "dry socket",
    ],
    en: "After an extraction, bite on gauze as instructed, rest, and avoid smoking, straws, and vigorous rinsing on the first day so the blood clot can form. Mild oozing can be normal; heavy bleeding, fever, or severe pain that worsens after a few days should be reported to the clinic. Follow the written after-care from your dentist.",
    tl: "Pagkatapos magpabunot, kagatin ang gauze ayon sa bilin, magpahinga, at iwasan ang paninigarilyo, straw, at malakas na pagmumog sa unang araw para mabuo ang dugo. Normal ang kaunting pagtagas; iulat sa klinika ang malakas na pagdurugo, lagnat, o sakit na lumalala pagkatapos ng ilang araw. Sundin ang nakasulat na after-care mula sa dentista.",
  },
  {
    keywords: [
      "whitening at home",
      "stain",
      "yellow teeth",
      "madilaw",
      "dilaw ang ngipin",
      "mantsa sa ngipin",
    ],
    en: "Surface stains from coffee, tea, or smoking often improve with cleaning and professional whitening. Over-the-counter strips can help mild discoloration but may cause sensitivity. The clinic offers professional teeth whitening after an exam. Whitening will not change crowns or fillings, and this assistant cannot promise a shade result.",
    tl: "Madalas gumaganda ang mantsa mula sa kape, tsaa, o yosi pagkatapos ng cleaning at professional whitening. Puwedeng tumulong ang OTC strips sa bahagyang pagkukulay pero puwedeng magdulot ng ngilo. May professional teeth whitening ang klinika pagkatapos ng exam. Hindi nababago ng whitening ang crown o pasta, at hindi makakapangako ang assistant ng shade result.",
  },
  {
    keywords: ["kids", "child", "children", "baby tooth", "bata", "anak", "ngipin ng bata"],
    en: "Children should start dental visits as primary teeth erupt. Supervise brushing with a smear or pea-sized amount of fluoride toothpaste, depending on age. A knocked-out baby tooth is usually not replanted; a knocked-out permanent tooth is a same-day emergency. Book a consultation for your child’s specific situation.",
    tl: "Dapat magpa-dentist ang mga bata kapag nagsisimulang tumubo ang unang ngipin. Bantayan ang pagsisipilyo: smear o kasing-laki ng gisantes na fluoride toothpaste, ayon sa edad. Karaniwang hindi ibinabalik ang natanggal na baby tooth; emergency sa araw ding iyon ang natanggal na permanenteng ngipin. Magpa-konsulta para sa sitwasyon ng anak.",
  },
  {
    keywords: ["bad breath", "halitosis", "mouth odor", "masamang hininga", "baho ng bibig"],
    en: "Bad breath is often related to plaque on the tongue and between teeth, dry mouth, or lingering food. Brush, floss, clean the tongue, and stay hydrated. If odor persists despite hygiene, a dental exam can look for gum issues or decay. This is general advice, not a diagnosis.",
    tl: "Madalas nauugnay ang masamang hininga sa plaque sa dila at pagitan ng ngipin, tuyong bibig, o natirang pagkain. Magsipilyo, mag-floss, linisin ang dila, at uminom ng tubig. Kung tuloy-tuloy ang amoy kahit malinis, tingnan sa dental exam kung may isyu sa gilagid o decay. Pangkalahatang payo ito, hindi diagnosis.",
  },
  {
    keywords: [
      "toothache",
      "tooth ache",
      "my tooth hurts",
      "pain in my tooth",
      "sakit ng ngipin",
      "masakit ang ngipin",
      "masakit ngipin",
      "sumasakit ang ngipin",
    ],
    en: "Toothache can come from decay, a cracked tooth, gum infection, or sinus pressure — only an exam can tell. Rinse gently with water and avoid placing aspirin on the gum. For severe, spreading, or night-time pain, call the clinic during hours. The clinic does not offer Emergency Dental Care as a bookable service. This assistant cannot diagnose the cause of your pain.",
    tl: "Puwedeng galing ang sakit ng ngipin sa decay, basag na ngipin, impeksyon sa gilagid, o sinus — exam lang ang makapagsasabi. Banlawan ng tubig at huwag maglagay ng aspirin sa gilagid. Kung malala, kumakalat, o sa gabi sumasakit, tawagan ang klinika habang bukas. Hindi nag-aalok ang klinika ng Emergency Dental Care bilang bookable na serbisyo. Hindi makakapag-diagnose ng dahilan ng sakit ang assistant na ito.",
  },
];

const ORAL_FALLBACK_RE = /(teeth|tooth|gum|oral|enamel|dentin|ngipin|gilagid|sipilyo|ngilo)/;

function pick(lang, en, tl) {
  return lang === "tl" ? tl : en;
}

function normalizeQuestion(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(question) {
  const padded = ` ${normalizeQuestion(question)} `;
  const hits = TAGALOG_MARKERS.filter((marker) => padded.includes(` ${marker} `)).length;
  return hits >= 1 ? "tl" : "en";
}

function clinicFrom(value) {
  const incoming = value && typeof value === "object" ? value : {};
  return {
    name: String(incoming.name || "").trim() || DEFAULT_CLINIC.name,
    address: String(incoming.address || "").trim() || DEFAULT_CLINIC.address,
    phone: String(incoming.phone || "").trim() || DEFAULT_CLINIC.phone,
    email: String(incoming.email || "").trim() || DEFAULT_CLINIC.email,
    operatingHours:
      String(incoming.operatingHours || incoming.operating_hours || "").trim() ||
      DEFAULT_CLINIC.operatingHours,
    todayHoursLabel: String(incoming.todayHoursLabel || "").trim() || null,
    todayClosed: Boolean(incoming.todayClosed),
  };
}

function normalizeOptions(servicesOrOptions) {
  if (Array.isArray(servicesOrOptions)) {
    return {
      services: servicesOrOptions,
      dentists: [],
      clinic: DEFAULT_CLINIC,
      knowledgeMode: "general",
      diagnosticsSensitivity: "balanced",
      patientContext: null,
    };
  }
  const options = servicesOrOptions && typeof servicesOrOptions === "object" ? servicesOrOptions : {};
  const mode = String(options.knowledgeMode || "").trim().toLowerCase();
  const sensitivity = String(options.diagnosticsSensitivity || "").trim().toLowerCase();
  return {
    services: Array.isArray(options.services) ? options.services : [],
    dentists: Array.isArray(options.dentists) ? options.dentists : [],
    clinic: clinicFrom(options.clinic),
    knowledgeMode: ["clinic", "general", "restricted"].includes(mode) ? mode : "general",
    diagnosticsSensitivity: ["conservative", "balanced", "aggressive"].includes(sensitivity)
      ? sensitivity
      : "balanced",
    patientContext: options.patientContext && typeof options.patientContext === "object"
      ? options.patientContext
      : null,
    conversationHistoryBlock: String(options.conversationHistoryBlock || ""),
    db: options.db || null,
    usageUserId: options.usageUserId || null,
    usageUserRole: options.usageUserRole || null,
    approvedServices: Array.isArray(options.approvedServices)
      ? options.approvedServices
      : APPROVED_CLINIC_SERVICES,
    approvedFactsEn: options.approvedFactsEn || APPROVED_SERVICE_FACTS_EN,
    approvedFactsTl: options.approvedFactsTl || APPROVED_SERVICE_FACTS_TL,
  };
}

function looksLikeFeeQuestion(normalized) {
  return /\b(how much|magkano|presyo|price|cost|fee|bayad|gastos|down payment|monthly adjustment|free|libre)\b/.test(
    normalized
  );
}

function matchApprovedClinicService(normalized, options = {}) {
  let best = null;
  let bestLen = 0;
  const catalog = Array.isArray(options.approvedServices)
    ? options.approvedServices
    : APPROVED_CLINIC_SERVICES;
  for (const service of catalog) {
    for (const alias of service.terms) {
      if (normalized.includes(alias) && alias.length >= bestLen) {
        best = service;
        bestLen = alias.length;
      }
    }
  }
  if (!best) return null;
  if (options.requireCue === false) return best;
  if (looksLikeFeeQuestion(normalized) || looksLikePersonalizedAdvice(normalized)) return best;
  if (bestLen >= 12) return best;
  return null;
}

function looksLikePersonalizedAdvice(normalized) {
  return /\b(best for me|best denture|what type|which type|what material|which material|ano ang best|anong type|anong material|anong klaseng|suitable|right for me|recommend|para sa akin|what(?:'s| is)? included|what does (?:it|the price) include|ano ang kasama)\b/.test(
    normalized
  );
}

function answerApprovedClinicService(service, normalized, lang) {
  if (
    looksLikePersonalizedAdvice(normalized) ||
    (service.id === "dentures" && /\b(types?|materials?|klaseng pustiso|anong pustiso)\b/.test(normalized))
  ) {
    if (service.id === "dentures") {
      return pick(
        lang,
        service.adviceEn ||
          "Our dentures range from ₱7,500 to ₱30,000, depending on the type and materials. 😊 The best option depends on your dental needs, so we recommend booking a consultation with our dentist. Good news—our consultation is free! Our dentist can explain the available options and help you choose what suits you best.",
        service.adviceTl ||
          "Ang dentures namin ay ₱7,500 hanggang ₱30,000, depending on the type and materials. 😊 Depende sa dental needs ninyo ang pinakabagay na option, kaya inirerekomenda namin ang consultation sa dentista. Maganda ang balita—libre ang consultation!"
      );
    }
    return pick(
      lang,
      `Of course! 😊 The right option depends on your dental needs, so I will not guess a material or treatment for you. ${service.en} We offer FREE consultation / oral examination so our dentist can assess you in person. You’re welcome to book a consultation with Amethyst Dental Clinic.`,
      `Siyempre! 😊 Depende sa pangangailangan ninyo ang tamang option, kaya hindi ako huhula ng material o treatment. ${service.tl} May FREE consultation / oral examination kami para personal na ma-assess kayo ng dentista. Welcome kayong mag-book ng consultation sa Amethyst Dental Clinic.`
    );
  }
  return pick(lang, service.en, service.tl);
}

function matchApprovedHmo(normalized) {
  let best = null;
  let bestLen = 0;
  for (const provider of APPROVED_HMO_PROVIDERS) {
    for (const alias of provider.aliases) {
      if (normalized.includes(alias) && alias.length >= bestLen) {
        best = provider;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

function matchUnlistedHmo(normalized) {
  if (matchApprovedHmo(normalized)) return null;
  return UNLISTED_HMO_HINTS.find((name) => normalized.includes(name)) || null;
}

function isHmoQuestion(normalized) {
  if (!normalized) return false;
  if (matchApprovedHmo(normalized) || matchUnlistedHmo(normalized)) return true;
  return /\b(hmos?|insurance|philhealth|accreditation)\b/.test(normalized);
}

function looksLikeHmoCredentialRequest(normalized) {
  return (
    isHmoQuestion(normalized) &&
    /\b(password|passwords|pin|otp|login credential|account login|hmo login|password ko|ihayag ang password)\b/.test(
      normalized
    )
  );
}

function looksLikeHmoApprovalQuestion(normalized) {
  return (
    isHmoQuestion(normalized) &&
    /\b(already approved|already verified|hmo already|approved na|na-verify|naverify|verification status|is my hmo already|approved ba)\b/.test(
      normalized
    )
  );
}

function looksLikeHmoCoverageQuestion(normalized) {
  return (
    isHmoQuestion(normalized) &&
    /\b(cover|covers|covered|coverage|sasaklaw|sakop|bayad ng hmo)\b/.test(normalized)
  );
}

function looksLikeHmoInfoQuestion(normalized) {
  return (
    isHmoQuestion(normalized) &&
    /\b(what information|what do i need|anong information|ano ang kailangan|member number|company name|birth date|birthday)\b/.test(
      normalized
    )
  );
}

function ownHmoVerification(patientContext) {
  const appointments = Array.isArray(patientContext?.appointments) ? patientContext.appointments : [];
  const withStatus = appointments.find((item) => item.hmoVerificationStatus && item.hmoVerificationStatus !== "not_applicable");
  if (!withStatus) return null;
  return {
    status: String(withStatus.hmoVerificationStatus || "").toLowerCase(),
    provider: withStatus.hmoProvider || null,
  };
}

function answerHmoQuestion(normalized, lang, patientContext) {
  if (looksLikeHmoCredentialRequest(normalized)) {
    return pick(
      lang,
      "I will never ask for your HMO password, PIN, or login credentials in this chat, and you should not send them here. Follow the clinic's HMO verification process in Appointments and with clinic staff only.",
      "Hindi ako hihingi ng HMO password, PIN, o login credentials sa chat na ito, at huwag mong ipadala rito. Sundin ang HMO verification process sa Appointments at sa clinic staff lamang."
    );
  }

  const unlisted = matchUnlistedHmo(normalized);
  if (unlisted) {
    return pick(
      lang,
      `I cannot confirm whether ${unlisted} is accommodated at Amethyst Dental Clinic. The approved list is ${HMO_PROVIDER_LIST}, each subject to account verification, accreditation arrangements, and coverage. Please contact clinic staff to ask about that provider. Do not send HMO passwords or PINs in this chat.`,
      `Hindi ko makokompirmang tinatanggap ang ${unlisted} sa Amethyst Dental Clinic. Ang approved list ay ${HMO_PROVIDER_LIST}, bawat isa subject sa account verification, accreditation arrangements, at coverage. Makipag-ugnayan sa clinic staff tungkol sa provider na iyon. Huwag magpadala ng HMO password o PIN sa chat.`
    );
  }

  if (looksLikeHmoApprovalQuestion(normalized)) {
    const own = ownHmoVerification(patientContext);
    if (own?.status === "verified") {
      return pick(
        lang,
        `Clinic staff have recorded HMO verification as complete for a booking on your signed-in account${own.provider ? ` (${own.provider})` : ""}. That does not automatically mean a particular dental service is covered. Ask staff to confirm eligibility and benefits for the procedure you need. ${HMO_PRIVACY_EN}`,
        `Naitala ng clinic staff na complete ang HMO verification para sa isang booking sa naka-sign in mong account${own.provider ? ` (${own.provider})` : ""}. Hindi nito automatic na sinasabing covered ang isang particular na dental service. Tanungin ang staff para kumpirmahin ang eligibility at benefits para sa procedure na kailangan mo. ${HMO_PRIVACY_TL}`
      );
    }
    if (own?.status === "pending_verification") {
      return pick(
        lang,
        "Your signed-in account shows an HMO booking that is still pending clinic staff verification. I cannot mark it as approved from this chat. Please wait for staff to confirm eligibility, plan benefits, and the requested dental service, or contact the front desk. " +
          HMO_PRIVACY_EN,
        "May HMO booking sa naka-sign in mong account na pending pa sa verification ng clinic staff. Hindi ko ito maaaring i-mark na approved mula sa chat. Hintayin ang staff na kumpirmahin ang eligibility, plan benefits, at hinihinging dental service, o tawagan ang front desk. " +
          HMO_PRIVACY_TL
      );
    }
    if (own?.status === "rejected") {
      return pick(
        lang,
        "A booking on your signed-in account shows HMO verification was not approved. I cannot change that status. Please contact clinic staff about next steps. " + HMO_PRIVACY_EN,
        "May booking sa naka-sign in mong account na hindi na-approve ang HMO verification. Hindi ko mababago ang status na iyon. Makipag-ugnayan sa clinic staff para sa susunod na hakbang. " + HMO_PRIVACY_TL
      );
    }
    return pick(
      lang,
      "I cannot confirm whether your HMO account is already approved from this chat unless clinic staff have recorded verification on your signed-in booking. Please book an appointment and complete the clinic's HMO verification process, or ask the front desk. Being on the HMO list does not guarantee eligibility or coverage. " +
        HMO_PRIVACY_EN,
      "Hindi ko makokompirmang approved na ang iyong HMO account mula sa chat maliban kung naitala na ng staff ang verification sa naka-sign in mong booking. Mag-book ng appointment at sundan ang HMO verification process, o tanungin ang front desk. Ang pagiging listed na HMO ay hindi guarantee ng eligibility o coverage. " +
        HMO_PRIVACY_TL
    );
  }

  if (looksLikeHmoInfoQuestion(normalized)) {
    return pick(
      lang,
      "For HMO verification, book from Appointments and complete the clinic's designated process. Staff typically need your HMO provider, member number, company name, and birth date so they can check your account, eligibility, plan benefits, and the requested dental service. Never send HMO passwords, PINs, or login credentials in this chat. " +
        HMO_PRIVACY_EN,
      "Para sa HMO verification, mag-book sa Appointments at sundan ang designated process ng klinika. Karaniwang kailangan ng staff ang HMO provider, member number, company name, at birthday para i-check ang account, eligibility, plan benefits, at hinihinging dental service. Huwag magpadala ng HMO password, PIN, o login credentials sa chat. " +
        HMO_PRIVACY_TL
    );
  }

  if (looksLikeHmoCoverageQuestion(normalized)) {
    const provider = matchApprovedHmo(normalized);
    const named = provider
      ? pick(
          lang,
          ` ${provider.name} is among the listed providers.`,
          ` Kasama ang ${provider.name} sa listed providers.`
        )
      : "";
    const filipino = provider?.filipinoDoctors
      ? pick(
          lang,
          " It is listed under Filipino Doctors, subject to the clinic's applicable accreditation and verification arrangements.",
          " Nakalista ito under Filipino Doctors, subject sa applicable accreditation at verification arrangements ng klinika."
        )
      : "";
    return pick(
      lang,
      `Coverage for a dental service such as cleaning depends on your HMO plan, eligibility, benefits, and the clinic's applicable arrangements.${named}${filipino} Being listed does not mean a procedure is covered without staff verification. Book an appointment so clinic staff can verify your account and the requested service before coverage is confirmed. I cannot promise copayments, limits, or approval codes. ${HMO_PRIVACY_EN}`,
      `Ang coverage para sa dental service tulad ng cleaning ay depende sa HMO plan, eligibility, benefits, at applicable arrangements ng klinika.${named}${filipino} Ang pagiging listed ay hindi ibig sabihing covered ang procedure nang walang verification ng staff. Mag-book ng appointment para ma-verify ng staff ang account at hinihinging service bago kumpirmahin ang coverage. Hindi ako makakapangako ng copayment, limit, o approval code. ${HMO_PRIVACY_TL}`
    );
  }

  const provider = matchApprovedHmo(normalized);
  if (provider) {
    const filipino = provider.filipinoDoctors
      ? pick(
          lang,
          ` ${provider.name} is listed under Filipino Doctors, subject to the clinic's applicable accreditation and verification arrangements.`,
          ` Nakalista ang ${provider.name} under Filipino Doctors, subject sa applicable accreditation at verification arrangements ng klinika.`
        )
      : "";
    return pick(
      lang,
      `Amethyst Dental Clinic accommodates patients with ${provider.name}, subject to account verification, applicable accreditation arrangements, eligibility, and coverage.${filipino} Being on the HMO list does not guarantee that a particular dental service is covered. Please book an appointment and follow the clinic's HMO verification process. Clinic staff must confirm your account, eligibility, plan benefits, and the requested dental service before coverage can be confirmed. ${HMO_PRIVACY_EN}`,
      `Tumanggap ang Amethyst Dental Clinic ng pasyente na may ${provider.name}, subject sa account verification, applicable accreditation arrangements, eligibility, at coverage.${filipino} Ang pagiging nasa HMO list ay hindi guarantee na covered ang isang particular na dental service. Mag-book ng appointment at sundan ang HMO verification process. Kailangang kumpirmahin ng clinic staff ang account, eligibility, plan benefits, at hinihinging dental service bago makumpirma ang coverage. ${HMO_PRIVACY_TL}`
    );
  }

  return pick(lang, HMO_DEFAULT_EN, HMO_DEFAULT_TL);
}

function looksLikeOtherPatientRequest(question) {
  const normalized = normalizeQuestion(question);
  if (!normalized) return false;
  if (
    /\b(my|mine|ako|ko|akin|sarili)\b/.test(normalized) &&
    !/\b(another|other|ibang|someone else)\b/.test(normalized)
  ) {
    return false;
  }
  return /(another patient|other patient|someone else|ibang pasyente|their diagnosis|his diagnosis|her diagnosis|patient named|list all patients|all patients|admin password|internal admin|phone number of|treatment history of)/.test(
    normalized
  );
}

function privacyRefusal(lang) {
  return pick(
    lang,
    "I can only discuss your own appointment or queue information while you are signed in, plus public clinic facts. I cannot share another patient's name, diagnosis, treatment, appointments, phone number, or payment details.",
    "Ang maaari kong pag-usapan ay ang sarili mong appointment o pila habang naka-sign in ka, at pampublikong impormasyon ng klinika. Hindi ako puwedeng magbahagi ng pangalan, diagnosis, treatment, appointment, numero, o bayad ng ibang pasyente."
  );
}

function restrictedRefusal(lang) {
  return pick(
    lang,
    "This assistant is currently limited to clinic operations information. For oral-care advice or a preliminary image review, please contact clinic staff or a licensed dentist.",
    "Limitado ngayon ang assistant na ito sa impormasyon ng operasyon ng klinika. Para sa payo sa ngipin o review ng litrato, makipag-ugnayan sa staff o lisensyadong dentista."
  );
}

function knowledgeModeInstructions(mode) {
  if (mode === "restricted") {
    return `Knowledge mode: restricted / staff only.
Answer only public clinic operations: hours, location, contact, booking, cancellation, queue/RFID/QR check-in, and listed services.
Do not give oral-hygiene tutorials, interpret symptoms, or review images.
If asked for clinical advice, tell the patient to contact staff or book an exam.`;
  }
  if (mode === "clinic") {
    return `Knowledge mode: clinic knowledge base.
Prefer DentaSync clinic facts: hours, location, official service prices, booking, cancellation, RFID/QR check-in, queue status meanings, and the approved HMO list.
You may briefly explain general procedures the clinic offers.
Quote only the approved peso prices and payment terms. Preserve “starting at,” “depending on the case,” and “per unit.”
Do not invent hours, fees, discounts, HMO coverage, or policies that are not in the clinic facts.
If a material, denture type, or treatment choice needs a personalized recommendation, invite a FREE consultation instead of guessing.`;
  }
  return `Knowledge mode: general dental guidance.
You may explain general oral hygiene, brushing, flossing, common dental concerns, preventive care, procedure overviews, and when to seek professional care.
Also answer Amethyst Dental Clinic questions using the clinic facts.
Quote only approved peso prices and payment terms. Preserve “starting at,” “depending on the case,” and “per unit.”
If a material, denture type, or treatment choice needs a personalized recommendation, invite a FREE consultation instead of guessing.
Do not invent clinic hours, services, discounts, extra fees, or policies.`;
}

function diagnosticsSensitivityInstructions(sensitivity) {
  if (sensitivity === "conservative") {
    return `Diagnostics sensitivity: conservative.
Be extra cautious. Flag symptoms for in-person evaluation quickly. Avoid speculative findings. Never claim a diagnosis. Always keep urgent-care advice for severe pain, swelling, fever, or uncontrolled bleeding.`;
  }
  if (sensitivity === "aggressive") {
    return `Diagnostics sensitivity: aggressive.
You may mention possible areas that a dentist should examine when the question or image suggests a concern, but you MUST NOT claim a definitive diagnosis or recommend treatment from an unverified AI finding.
Never suppress urgent-care recommendations when warning signs are present.`;
  }
  return `Diagnostics sensitivity: balanced.
Share cautious, preliminary guidance only. Never claim a diagnosis or replace a dentist. Keep urgent-care recommendations when warning signs are present.`;
}

function keywordHits(normalized, keywords) {
  return keywords.filter((keyword) => normalized.includes(keyword)).length;
}

function matchService(normalized, services) {
  let best = null;
  let bestScore = 0;
  for (const service of services) {
    if (service?.bookable === false) continue;
    let score = 0;
    const name = String(service.name || "").toLowerCase();
    if (name && normalized.includes(name)) score += 5;
    const tokens = name
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5 && !GENERIC_SERVICE_TOKENS.has(token));
    for (const token of tokens) {
      if (normalized.includes(token)) score += 2;
    }
    const aliases = SERVICE_ALIASES.find((item) => item.id === service.id);
    for (const term of aliases?.terms || []) {
      if (normalized.includes(term)) score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = service;
    }
  }
  return bestScore >= 2 ? best : null;
}

function matchTopic(normalized, topics) {
  let best = null;
  let bestScore = 0;
  for (const topic of topics) {
    const score = keywordHits(normalized, topic.keywords);
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return bestScore > 0 ? best : null;
}

function describeService(service, lang, approvedCatalog = APPROVED_CLINIC_SERVICES) {
  const intro = service.description || pick(lang, "Available at Amethyst Dental.", "Available sa Amethyst Dental.");
  const parts = [`${service.name}: ${intro}`];
  if (service.durationMinutes) {
    parts.push(
      pick(
        lang,
        `A typical visit is about ${service.durationMinutes} minutes.`,
        `Karaniwang tumatagal ang bisita ng mga ${service.durationMinutes} minuto.`
      )
    );
  }
  const bookingToApproved = {
    cleaning: "cleaning",
    extraction: "extraction",
    filling: "filling",
    whitening: "whitening",
    "general-consultation": "consultation",
    "orthodontic-consultation": "consultation",
    "ortho-adjustment": "ortho-adjustment",
    "root-canal": "root-canal",
    odontectomy: "odontectomy",
    frenectomy: "frenectomy",
    dentures: "dentures",
    "fixed-bridge": "crown-bridge",
    "dental-crowns": "crown-bridge",
    veneers: "veneers",
    "dental-implants": "dental-implants",
    "gum-contouring": "gum-contouring",
  };
  const mappedId = bookingToApproved[String(service.id || "")];
  const approved = mappedId
    ? approvedCatalog.find((item) => item.id === mappedId)
    : matchApprovedClinicService(normalizeQuestion(`${service.name || ""} how much`), {
        approvedServices: approvedCatalog,
      });
  if (approved) {
    return answerApprovedClinicService(approved, normalizeQuestion(`how much is ${service.name || approved.id}`), lang);
  }
  parts.push(
    pick(
      lang,
      "Book it from Appointments. This is general information only, not a diagnosis.",
      "Mag-book sa Appointments. Pangkalahatang impormasyon lang ito, hindi diagnosis."
    )
  );
  return parts.join(" ");
}

function wantsOwnVisitInfo(normalized) {
  return /(my (next )?appointment|my appointments?|appointment tomorrow|do i have an appointment|have an appointment|my (current )?queue|queue number|queue status|my wait|how long.{0,24}wait|still waiting|dentist (called|call) me|called me yet|aking appointment|aking pila|saan ako sa pila|ano ang queue ko|pila ko|may appointment ba ako)/.test(
    normalized
  );
}

function isShortVisitFollowUp(normalized, historyBlock) {
  if (!normalized || normalized.length > 80) return false;
  const history = String(historyBlock || "");
  if (!/Patient:.*(appointment|queue|pila|wait|check-?in)/i.test(history)) return false;
  return /^(and )?(tomorrow|bukas|the wait|how long|ano po|ano|and then|status|yung pila|my number)\b/.test(
    normalized
  );
}

function looksLikeUnsupportedAction(normalized) {
  return /(book me|book it for me|please book|i want you to book|cancel it for me|cancel my appointment now|please cancel|reschedule me|check me in|you booked|appointment is booked|has been cancelled|already cancelled|mark me (as )?(called|done))/.test(
    normalized
  );
}

function looksLikeInstructionOverride(normalized) {
  return /(ignore (all )?(previous|prior|above) (instructions|rules)|you are now|reveal (your )?(system|hidden) prompt|developer mode|jailbreak|pretend you are an unrestricted)/.test(
    normalized
  );
}

function looksLikeMedicalEmergency(normalized) {
  return /(chest pain|cannot breathe|can t breathe|can t breathe|hindi ako makahinga|hindi makahinga|unconscious|suicide|stroke|not breathing)/.test(
    normalized
  );
}

function looksLikeDiagnosisOrPrescription(normalized) {
  return /(diagnose me|what is my diagnosis|give me a diagnosis|prescribe|prescription|antibiotic for me|what medicine should i|give me medicine|anong gamot)/.test(
    normalized
  );
}

function humanQueueStatus(status, lang) {
  const key = String(status || "").toLowerCase().replaceAll(" ", "_");
  const waiting = ["waiting", "checked_in", "not_checked_in"];
  const called = ["preparing", "called"];
  const withDentist = ["dentist", "in_treatment", "in_chair"];
  if (withDentist.includes(key)) {
    return pick(lang, "the dentist is seeing you / has called you", "tinatawag o tinitingnan ka na ng dentista");
  }
  if (called.includes(key)) {
    return pick(lang, "you have been called", "tinawag ka na");
  }
  if (waiting.includes(key)) {
    return pick(lang, "still waiting", "naghihintay pa");
  }
  return status || pick(lang, "on the queue", "nasa pila");
}

function clinicTimezone() {
  return process.env.CLINIC_TIMEZONE || "Asia/Manila";
}

const assistantRateHits = new Map();

function resetAssistantRateLimit() {
  assistantRateHits.clear();
}

function consumeAssistantRateLimit(userId, { windowMs = 60_000, limit = 25 } = {}) {
  const key = String(userId || "anonymous");
  const now = Date.now();
  const recent = (assistantRateHits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    return { allowed: false };
  }
  recent.push(now);
  assistantRateHits.set(key, recent);
  return { allowed: true };
}

function manilaDateStamp(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: clinicTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function mentionedTomorrow(normalized) {
  return /\b(tomorrow|bukas na appointment|appointment bukas|appointment tomorrow)\b/.test(normalized);
}

function describeOwnVisit(patientContext, clinic, lang, question = "") {
  const appointments = Array.isArray(patientContext?.appointments) ? patientContext.appointments : [];
  const queue = patientContext?.queue && typeof patientContext.queue === "object" ? patientContext.queue : null;
  const normalized = normalizeQuestion(question);
  const tomorrow = mentionedTomorrow(normalized);
  const tomorrowStamp = (() => {
    const now = new Date();
    const today = manilaDateStamp(now);
    const [year, month, day] = today.split("-").map(Number);
    return manilaDateStamp(new Date(Date.UTC(year, month - 1, day + 1, 4, 0, 0)));
  })();
  const listed = tomorrow ? appointments.filter((item) => item.date === tomorrowStamp) : appointments;
  const parts = [];
  if (queue && !tomorrow) {
    const wait =
      queue.waitMinutes == null
        ? pick(lang, " No wait estimate is available yet.", " Wala pang estimated wait.")
        : pick(
            lang,
            ` Estimated wait is about ${queue.waitMinutes} minutes.`,
            ` Mga ${queue.waitMinutes} minuto ang estimated wait.`
          );
    const called = /called|dentist|in_treatment|in_chair|preparing/i.test(String(queue.status || ""));
    parts.push(
      pick(
        lang,
        `Your queue number is ${queue.token || queue.queueNumber || "assigned"} — ${humanQueueStatus(queue.status, lang)}.${wait}${
          called ? "" : " The dentist has not called you based on the current queue status."
        }`,
        `Ang iyong queue number ay ${queue.token || queue.queueNumber || "nakatalaga"} — ${humanQueueStatus(queue.status, lang)}.${wait}${
          called ? "" : " Hindi ka pa tinatawag ng dentista ayon sa kasalukuyang status ng pila."
        }`
      )
    );
  }
  if (listed.length) {
    const next = listed[0];
    parts.push(
      pick(
        lang,
        `${tomorrow ? "Tomorrow" : "Your next listed visit"} is ${next.service || "a dental visit"} on ${next.date || "the scheduled date"} at ${next.time || "the scheduled time"} (${next.status || "scheduled"}).`,
        `${tomorrow ? "Bukas" : "Ang iyong susunod na bisita"} ay ${next.service || "dental visit"} sa ${next.date || "takdang petsa"} nang ${next.time || "takdang oras"} (${next.status || "scheduled"}).`
      )
    );
  } else if (tomorrow) {
    parts.push(
      pick(
        lang,
        "I do not see an appointment tomorrow on your signed-in account.",
        "Walang appointment bukas sa naka-sign in mong account."
      )
    );
  }
  if (!parts.length) {
    return pick(
      lang,
      `I do not see an active appointment or queue ticket on your signed-in account. Book from Appointments or check in with staff at ${clinic.name}.`,
      `Walang aktibong appointment o queue ticket sa naka-sign in mong account. Mag-book sa Appointments o mag-check in sa staff ng ${clinic.name}.`
    );
  }
  parts.push(
    pick(
      lang,
      "This is only your own visit information from DentaSync. I cannot share other patients' records.",
      "Sarili mong impormasyon ng bisita mula sa DentaSync lang ito. Hindi ako puwedeng magbahagi ng rekord ng ibang pasyente."
    )
  );
  return parts.join(" ");
}

function languageInstruction(question) {
  const lang = detectLanguage(question);
  if (lang === "tl") {
    return "Reply in Filipino/Tagalog (Taglish is fine if the patient mixed English). Do not switch to English-only unless the patient wrote in English.";
  }
  return "Reply in the same language the patient used (English, Filipino/Tagalog, or mixed Taglish).";
}

function answerFromCatalog(question, servicesOrOptions) {
  const {
    services,
    dentists,
    clinic,
    knowledgeMode,
    patientContext,
    conversationHistoryBlock,
    approvedServices,
    approvedFactsEn,
    approvedFactsTl,
  } = normalizeOptions(servicesOrOptions);
  const normalized = normalizeQuestion(question);
  const lang = detectLanguage(question);
  if (looksLikeOtherPatientRequest(question)) {
    return { answer: privacyRefusal(lang), source: "privacy", language: lang };
  }
  if (looksLikeInstructionOverride(normalized)) {
    return {
      answer: pick(
        lang,
        "I can only help as the Amethyst Dental patient assistant. Ask about clinic hours, services, your own appointment or queue, or general oral care.",
        "Bilang assistant ng pasyente ng Amethyst Dental lang ako makakatulong. Magtanong tungkol sa oras, serbisyo, sarili mong appointment o pila, o pangkalahatang alaga sa ngipin."
      ),
      source: "safety",
      language: lang,
    };
  }
  if (looksLikeMedicalEmergency(normalized)) {
    return {
      answer: pick(
        lang,
        "If this could be a medical emergency (for example chest pain, trouble breathing, or loss of consciousness), seek emergency medical assistance immediately. For urgent dental pain during clinic hours, call the clinic. The clinic does not offer Emergency Dental Care as a bookable service.",
        "Kung posibleng emergency medikal (halimbawa pananakit ng dibdib, hirap huminga, o nawalan ng malay), humingi agad ng emergency medical assistance. Para sa malubhang sakit ng ngipin habang bukas ang klinika, tumawag sa clinic. Hindi nag-aalok ang klinika ng Emergency Dental Care bilang bookable na serbisyo."
      ),
      source: "safety",
      language: lang,
    };
  }
  if (looksLikeDiagnosisOrPrescription(normalized)) {
    return {
      answer: pick(
        lang,
        "I cannot diagnose a condition or prescribe medication. AI information is preliminary and does not replace examination or diagnosis by a licensed dentist. Please book an oral examination or contact clinic staff.",
        "Hindi ako makakapag-diagnose o magreseta ng gamot. Preliminary lang ang AI at hindi pumapalit sa exam o diagnosis ng lisensyadong dentista. Mag-book ng oral examination o kausapin ang staff."
      ),
      source: "safety",
      language: lang,
    };
  }
  if (looksLikeUnsupportedAction(normalized)) {
    return {
      answer: pick(
        lang,
        "I cannot book, cancel, reschedule, or check you in from this chat. Use Appointments to submit or cancel a visit, Queue Status or the front desk for RFID/QR check-in, and contact staff if something fails. I will not say a booking or cancellation succeeded unless DentaSync confirms it.",
        "Hindi ako makakapag-book, mag-cancel, mag-reschedule, o mag-check in mula sa chat. Gamitin ang Appointments para mag-submit o mag-cancel, ang Queue Status o front desk para sa RFID/QR check-in, at tawagan ang staff kung may sira. Hindi ako magsasabing successful ang booking o cancel kung hindi kino-confirm ng DentaSync."
      ),
      source: "procedure",
      language: lang,
    };
  }
  if (!normalized) {
    return {
      answer: pick(
        lang,
        `Ask about ${clinic.name} hours, location, services, booking, queue check-in, or teeth and oral-care topics. I cannot provide a diagnosis.`,
        `Magtanong tungkol sa oras, lokasyon, serbisyo, booking, pila, o ngipin at oral care sa ${clinic.name}. Hindi ako makakapagbigay ng diagnosis.`
      ),
      source: "faq",
      language: lang,
    };
  }

  if (isHmoQuestion(normalized)) {
    return {
      answer: answerHmoQuestion(normalized, lang, patientContext),
      source: "hmo",
      language: lang,
    };
  }

  const approvedService = matchApprovedClinicService(normalized, { approvedServices });
  if (approvedService) {
    return {
      answer: answerApprovedClinicService(approvedService, normalized, lang),
      source: "catalog",
      language: lang,
    };
  }

  if (
    patientContext &&
    (wantsOwnVisitInfo(normalized) || isShortVisitFollowUp(normalized, conversationHistoryBlock))
  ) {
    return {
      answer: describeOwnVisit(patientContext, clinic, lang, question),
      source: "patient-own",
      language: lang,
    };
  }

  const service = matchService(normalized, services);
  const clinicTopic = matchTopic(normalized, CLINIC_TOPICS);
  const oralTopic = matchTopic(normalized, ORAL_HEALTH_TOPICS);
  const oralHits = oralTopic ? keywordHits(normalized, oralTopic.keywords) : 0;
  const clinicHits = clinicTopic ? keywordHits(normalized, clinicTopic.keywords) : 0;
  const preferOralOverService = Boolean(oralTopic && oralHits > 0 && clinicHits <= oralHits);

  if (
    service &&
    !preferOralOverService &&
    (!clinicTopic || clinicTopic.id === "services" || clinicTopic.id === "emergency")
  ) {
    return {
      answer: describeService(service, lang, approvedServices),
      source: "catalog",
      language: lang,
    };
  }

  if (
    clinicTopic &&
    (!oralTopic || keywordHits(normalized, clinicTopic.keywords) >= keywordHits(normalized, oralTopic.keywords))
  ) {
    return {
      answer: clinicTopic.build(clinic, dentists, services, lang, {
        factsEn: approvedFactsEn,
        factsTl: approvedFactsTl,
      }),
      source: "faq",
      language: lang,
    };
  }

  if (oralTopic) {
    if (knowledgeMode === "restricted") {
      return { answer: restrictedRefusal(lang), source: "restricted", language: lang };
    }
    return { answer: pick(lang, oralTopic.en, oralTopic.tl), source: "oral-health", language: lang };
  }

  if (ORAL_FALLBACK_RE.test(normalized)) {
    if (knowledgeMode === "restricted") {
      return { answer: restrictedRefusal(lang), source: "restricted", language: lang };
    }
    return {
      answer: pick(
        lang,
        "I can explain general tooth anatomy, brushing, flossing, cavities, gum care, sensitivity, and clinic services. Share a more specific question — for example, how to brush, what a molar is, or our cleaning service. I cannot diagnose your symptoms; a dentist needs an in-person exam for that.",
        "Maipapaliwanag ko ang pangkalahatang anatomy ng ngipin, pagsisipilyo, flossing, cavity, alaga sa gilagid, ngilo, at serbisyo ng klinika. Magtanong nang mas spesifik — halimbawa, paano magsipilyo, ano ang molar, o ang cleaning namin. Hindi ako makakapag-diagnose; kailangan ng personal na exam ng dentista."
      ),
      source: "oral-health",
      language: lang,
    };
  }

  return {
    answer: pick(
      lang,
      `I can help with ${clinic.name} hours, location, services, booking, HMO, queue check-in, and general questions about teeth and oral care. For personal medical advice or a diagnosis, please speak with your dentist or staff.`,
      `Makakatulong ako sa oras, lokasyon, serbisyo, booking, HMO, pila, at pangkalahatang tanong tungkol sa ngipin at oral care sa ${clinic.name}. Para sa personal na payong medikal o diagnosis, kausapin ang dentista o staff.`
    ),
    source: "faq",
    language: lang,
  };
}

function clinicContextBlock(clinic, services, dentists, factsEn = APPROVED_SERVICE_FACTS_EN) {
  const serviceLines = factsEn;
  const dentistLines = dentists
    .map((dentist) => `- ${dentist.name}${dentist.specialty ? `, ${dentist.specialty}` : ""}`)
    .join("\n");
  return `Clinic facts (use these; do not invent different hours or contact details):
Name: ${clinic.name}
Address: ${clinic.address}
Phone: ${clinic.phone}
Email: ${clinic.email}
Hours: ${clinic.operatingHours}
Patients book a service and time; the clinic assigns an available dentist.

Services:
${serviceLines || "(see Appointments in the patient portal)"}

Dentists:
${dentistLines || "(assigned by the clinic)"}

Approved HMO providers (do not add others; listing is not a coverage guarantee):
${APPROVED_HMO_PROVIDERS.map((item) => `- ${item.name}${item.filipinoDoctors ? " (listed under Filipino Doctors; accreditation/verification arrangements apply)" : ""}`).join("\n")}
Staff must verify account, eligibility, benefits, and the requested service after the patient books. Never claim an HMO is verified, never invent copays or covered procedures, and never ask for HMO passwords or PINs.`;
}

async function loadClinicProfile(db) {
  if (!db || typeof db.query !== "function") {
    return { ...DEFAULT_CLINIC };
  }
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic' LIMIT 1`
    );
    return clinicFrom(result.rows[0]?.setting_value);
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return { ...DEFAULT_CLINIC };
    }
    return { ...DEFAULT_CLINIC };
  }
}

async function loadClinicKnowledge(db) {
  const clinic = await loadClinicProfile(db);
  try {
    const clinicSchedule = require("./clinicSchedule");
    const hours = await clinicSchedule.summarizeOperatingHours(db);
    return {
      ...clinic,
      operatingHours: hours.weekLabel || clinic.operatingHours,
      todayHoursLabel: hours.todayLabel,
      todayClosed: hours.todayClosed,
    };
  } catch {
    return clinic;
  }
}

async function loadAuthorizedPatientContext(db, userId, { includeWait = true } = {}) {
  if (!db || !userId) return null;
  const context = { appointments: [], queue: null };
  const tz = clinicTimezone();
  try {
    const appointments = await db.query(
      `SELECT service_name, appointment_date::text AS appointment_date,
              appointment_time::text AS appointment_time, status,
              hmo_provider, hmo_verification_status
       FROM patient_portal_appointments
       WHERE user_id = $1
         AND LOWER(COALESCE(status, 'pending')) NOT IN ('cancelled', 'denied', 'completed', 'no_show')
         AND appointment_date >= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
       ORDER BY appointment_date ASC, appointment_time ASC
       LIMIT 3`,
      [String(userId), tz]
    );
    context.appointments = appointments.rows.map((row) => ({
      service: row.service_name,
      date: String(row.appointment_date || "").slice(0, 10),
      time: String(row.appointment_time || "").slice(0, 5),
      status: row.status,
      hmoProvider: row.hmo_provider || null,
      hmoVerificationStatus: row.hmo_verification_status || null,
    }));
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      try {
        const fallback = await db.query(
          `SELECT service_name, appointment_date::text AS appointment_date,
                  appointment_time::text AS appointment_time, status
           FROM patient_portal_appointments
           WHERE user_id = $1
             AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
           ORDER BY appointment_date ASC, appointment_time ASC
           LIMIT 3`,
          [String(userId)]
        );
        context.appointments = fallback.rows.map((row) => ({
          service: row.service_name,
          date: String(row.appointment_date || "").slice(0, 10),
          time: String(row.appointment_time || "").slice(0, 5),
          status: row.status,
        }));
      } catch (fallbackError) {
        if (fallbackError?.code !== "42P01" && fallbackError?.code !== "42703") {
          console.warn("Patient assistant appointment context skipped:", fallbackError.message);
        }
      }
    } else {
      console.warn("Patient assistant appointment context skipped:", error.message);
    }
  }
  try {
    const queue = await db.query(
      `SELECT token, position, status, estimated_wait_minutes,
              wait_estimate_duration_minutes
       FROM patient_portal_queue_entries
       WHERE user_id = $1
         AND (checked_in_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
         AND status NOT IN ('completed', 'no_show')
       ORDER BY checked_in_at DESC
       LIMIT 1`,
      [String(userId), tz]
    );
    if (queue.rows[0]) {
      const waitValue = includeWait
        ? queue.rows[0].wait_estimate_duration_minutes ?? queue.rows[0].estimated_wait_minutes
        : null;
      context.queue = {
        token: queue.rows[0].token,
        queueNumber: queue.rows[0].token,
        position: queue.rows[0].position,
        status: queue.rows[0].status,
        waitMinutes: waitValue == null ? null : Number(waitValue),
      };
    }
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      try {
        const fallback = await db.query(
          `SELECT token, position, status, estimated_wait_minutes
           FROM patient_portal_queue_entries
           WHERE user_id = $1
             AND DATE(checked_in_at) = CURRENT_DATE
             AND status NOT IN ('completed', 'no_show')
           ORDER BY checked_in_at DESC
           LIMIT 1`,
          [String(userId)]
        );
        if (fallback.rows[0]) {
          context.queue = {
            token: fallback.rows[0].token,
            queueNumber: fallback.rows[0].token,
            position: fallback.rows[0].position,
            status: fallback.rows[0].status,
            waitMinutes: includeWait ? fallback.rows[0].estimated_wait_minutes : null,
          };
        }
      } catch (fallbackError) {
        if (fallbackError?.code !== "42P01" && fallbackError?.code !== "42703") {
          console.warn("Patient assistant queue context skipped:", fallbackError.message);
        }
      }
    } else {
      console.warn("Patient assistant queue context skipped:", error.message);
    }
  }
  return context;
}

function slimPatientContext(patientContext) {
  if (!patientContext || typeof patientContext !== "object") return null;
    const appointments = Array.isArray(patientContext.appointments)
      ? patientContext.appointments.slice(0, 3).map((item) => ({
          service: item.service || null,
          date: item.date || null,
          time: item.time || null,
          status: item.status || null,
          hmoVerificationStatus: item.hmoVerificationStatus || null,
        }))
    : [];
  const queue = patientContext.queue
    ? {
        queueNumber: patientContext.queue.token || patientContext.queue.queueNumber || null,
        status: patientContext.queue.status || null,
        waitMinutes: patientContext.queue.waitMinutes ?? null,
      }
    : null;
  return { appointments, queue };
}

async function generateGeminiText(apiKey, prompt) {
  const { parseGeminiUsage, trackAiUsage } = require("./aiUsage");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let recorded = false;
  const record = (event) => {
    if (recorded) return;
    recorded = true;
    trackAiUsage({
      feature: "patient_assistant",
      model: "gemini-1.5-flash",
      ...event,
    });
  };
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 420 },
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      record({ outcome: "failed", httpStatus: response.status });
      const error = new Error(`gemini-http-${response.status}`);
      error.code = response.status === 429 ? "rate_limit" : "http";
      throw error;
    }
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) {
      record({ outcome: "failed", httpStatus: 200, usage: parseGeminiUsage(payload) });
      const error = new Error("gemini-empty");
      error.code = "empty";
      throw error;
    }
    record({ outcome: "success", httpStatus: 200, usage: parseGeminiUsage(payload) });
    return text;
  } catch (error) {
    record({ outcome: "failed" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function answerWithOptionalGemini(question, servicesOrOptions) {
  const options = normalizeOptions(servicesOrOptions);
  const local = answerFromCatalog(question, options);
  const apiKey = process.env.GEMINI_API_KEY;
  const normalized = normalizeQuestion(question);
  const clinicIntent = Boolean(matchTopic(normalized, CLINIC_TOPICS));
  const oralIntent =
    Boolean(matchTopic(normalized, ORAL_HEALTH_TOPICS)) || ORAL_FALLBACK_RE.test(normalized);

  if (["privacy", "restricted", "patient-own", "safety", "procedure", "hmo", "catalog"].includes(local.source)) {
    return { ...local, model: "clinic-faq" };
  }

  // Clinic facts stay on the local catalog so hours, phone, and fees are not invented.
  if (!apiKey || (clinicIntent && !oralIntent) || options.knowledgeMode === "restricted") {
    return { ...local, model: "clinic-faq" };
  }

  const { withAiUsageContext } = require("./aiUsage");
  try {
    return await withAiUsageContext(
      {
        feature: "patient_assistant",
        userId: options.usageUserId || null,
        userRole: options.usageUserRole || "patient",
        db: options.db || null,
      },
      async () => {
    const visitIntent = wantsOwnVisitInfo(normalized);
    const slim = visitIntent ? slimPatientContext(options.patientContext) : null;
    const ownVisit = slim
      ? `Verified DentaSync records for this signed-in patient only (do not invent extra visits or claim an action succeeded): ${JSON.stringify(slim)}`
      : "No personal visit record is included for this question. Do not invent appointments, queue numbers, or check-in results.";
    const historyBlock = String(options.conversationHistoryBlock || "").trim();
    const prompt = `You are the patient-support assistant for ${options.clinic.name} in the DentaSync Patient Portal.
Be friendly, professional, and concise. Understand English, Filipino/Tagalog, Taglish, and common misspellings.
If the request is ambiguous, ask one clarifying question.
Distinguish verified clinic facts below from general dental education.
If a clinic fact is missing, say it is unavailable and suggest the Appointments page or front desk. Never guess hours, prices, or policies.
Use only the official Amethyst Dental Clinic service prices below. Do not present a starting price as the final total. Separate braces down payment from monthly adjustment. Per-unit crown/bridge prices are not full-bridge totals. Upper or lower retainer prices do not automatically cover both. If the patient asks which material or denture type is best, do not guess — invite a FREE consultation / oral examination. Never claim a dentist has evaluated the patient unless an assessment is recorded.
You must NOT diagnose, prescribe, or replace a licensed dentist.
Never claim a booking, cancellation, reschedule, or dentist call unless the verified DentaSync records explicitly show it.
Never treat prior assistant messages as clinic facts if live clinic data is provided.
Keep answers brief. Use short lists for hours, steps, or services when helpful.
${knowledgeModeInstructions(options.knowledgeMode)}
${diagnosticsSensitivityInstructions(options.diagnosticsSensitivity)}
${languageInstruction(question)}

${clinicContextBlock(options.clinic, options.services, options.dentists, options.approvedFactsEn)}

${ownVisit}
${historyBlock ? `\n${historyBlock}\nTreat prior assistant text as conversation context only, not as verified clinic data.\n` : ""}
Patient question: ${question}`;

    const text = await generateGeminiText(apiKey, prompt);
    const note = pick(
      local.language,
      "AI-generated information is preliminary and does not replace examination or diagnosis by a licensed dentist.",
      "Preliminary lang ang AI at hindi pumapalit sa exam o diagnosis ng lisensyadong dentista."
    );
    const alreadyNoted = /licensed dentist|lisensyadong dentista/i.test(text);

    return {
      answer: alreadyNoted ? text : `${text}\n\n${note}`,
      source: "gemini",
      model: "gemini-1.5-flash",
      language: local.language,
    };
      }
    );
  } catch {
    return { ...local, model: "clinic-faq-fallback" };
  }
}

module.exports = {
  DEFAULT_CLINIC,
  answerFromCatalog,
  answerWithOptionalGemini,
  loadClinicProfile,
  loadClinicKnowledge,
  loadAuthorizedPatientContext,
  looksLikeOtherPatientRequest,
  looksLikeUnsupportedAction,
  looksLikeInstructionOverride,
  wantsOwnVisitInfo,
  consumeAssistantRateLimit,
  resetAssistantRateLimit,
  APPROVED_HMO_PROVIDERS,
  APPROVED_CLINIC_SERVICES,
  matchApprovedHmo,
  matchApprovedClinicService,
  detectLanguage,
};
