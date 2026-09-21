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
  operatingHours: "Monday–Saturday · 9:00 AM – 6:00 PM",
};

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
  { id: "emergency-care", terms: ["emergency", "urgent pain", "emergency care"] },
  { id: "oral-surgery", terms: ["oral surgery", "surgical"] },
  {
    id: "dentures-bridge-crown",
    terms: ["denture", "dentures", "bridge", "crown", "cap", "pustiso", "korona"],
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
    build: (clinic, _dentists, _services, lang) =>
      pick(
        lang,
        `${clinic.name} is open ${clinic.operatingHours}. Appointments are booked from the Appointments page. Portal messages are reviewed during clinic hours.`,
        `Bukas ang ${clinic.name} tuwing ${clinic.operatingHours}. Mag-book ng appointment sa page na Appointments. Sinusuri ang mga mensahe sa portal sa oras ng klinika.`
      ),
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
    keywords: ["hmo", "insurance", "coverage", "philhealth"],
    build: (_clinic, _dentists, _services, lang) =>
      pick(
        lang,
        "You can book with HMO coverage or pay out of pocket. If using HMO, provide your provider, member number, company name, and birth date during booking so staff can verify eligibility.",
        "Pwede kang mag-book gamit ang HMO o magbayad nang cash. Kung HMO, ibigay ang provider, member number, kumpanya, at birthday habang nagbu-book para ma-verify ng staff ang eligibility."
      ),
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
        "After your appointment is confirmed, check in from Queue Status or with staff via RFID or QR. Your queue number and estimated wait appear on the patient Queue page. Staff and dentists use the same clinic queue.",
        "Kapag confirmed na ang appointment, mag-check in sa Queue Status o sa staff gamit ang RFID o QR. Makikita ang queue number at estimated wait sa Queue page. Iisa ang pila ng staff at dentist."
      ),
  },
  {
    id: "booking",
    keywords: [
      "book",
      "booking",
      "appointment",
      "schedule a visit",
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
        "Book from Appointments in the patient portal. Choose a service, date, and time, then submit for clinic confirmation. You do not pick a dentist — the clinic assigns an available clinician for that slot.",
        "Mag-book sa Appointments sa patient portal. Pumili ng serbisyo, petsa, at oras, tapos i-submit para sa confirmation ng klinika. Hindi ka pumipili ng dentist — ang clinic ang mag-a-assign ng available na clinician sa slot na iyon."
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
    build: (_clinic, _dentists, services, lang) => {
      if (!services.length) {
        return pick(
          lang,
          "Amethyst Dental offers cleaning, fillings, extractions, root canal treatment, whitening, orthodontic consultation, dentures or crowns, oral surgery, and emergency care. Book from Appointments.",
          "May cleaning, pasta, bunot, root canal, whitening, orthodontic consultation, pustiso o crown, oral surgery, at emergency care ang Amethyst Dental. Mag-book sa Appointments."
        );
      }
      const list = services
        .map((service) => {
          const cost = formatPesos(service.estimatedCost);
          return cost ? `${service.name} (from about ${cost})` : service.name;
        })
        .join("; ");
      return pick(
        lang,
        `Clinic services include ${list}. Fees are estimates and are confirmed at the clinic. Book from Appointments.`,
        `Kasama sa serbisyo ng klinika: ${list}. Estimate lang ang fees at kino-confirm sa clinic. Mag-book sa Appointments.`
      );
    },
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
        `For urgent dental pain or swelling, book Emergency Dental Care if a slot is available, or call ${clinic.name} at ${clinic.phone}. This assistant cannot diagnose emergencies — seek in-person care for severe symptoms.`,
        `Kung matindi ang sakit ng ngipin o may pamamaga, mag-book ng Emergency Dental Care kung may slot, o tumawag sa ${clinic.name} sa ${clinic.phone}. Hindi makakapag-diagnose ang assistant na ito — magpatingin mismo kung malala ang sintomas.`
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
    en: "Toothache can come from decay, a cracked tooth, gum infection, or sinus pressure — only an exam can tell. Rinse gently with water and avoid placing aspirin on the gum. For severe, spreading, or night-time pain, book Emergency Dental Care or call the clinic. This assistant cannot diagnose the cause of your pain.",
    tl: "Puwedeng galing ang sakit ng ngipin sa decay, basag na ngipin, impeksyon sa gilagid, o sinus — exam lang ang makapagsasabi. Banlawan ng tubig at huwag maglagay ng aspirin sa gilagid. Kung malala, kumakalat, o sa gabi sumasakit, mag-book ng Emergency Dental Care o tawagan ang klinika. Hindi makakapag-diagnose ng dahilan ng sakit ang assistant na ito.",
  },
];

const ORAL_FALLBACK_RE = /(teeth|tooth|gum|oral|enamel|dentin|ngipin|gilagid|sipilyo|ngilo)/;

function formatPesos(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `₱${amount.toLocaleString("en-PH")}`;
}

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
  };
}

function normalizeOptions(servicesOrOptions) {
  if (Array.isArray(servicesOrOptions)) {
    return { services: servicesOrOptions, dentists: [], clinic: DEFAULT_CLINIC };
  }
  const options = servicesOrOptions && typeof servicesOrOptions === "object" ? servicesOrOptions : {};
  return {
    services: Array.isArray(options.services) ? options.services : [],
    dentists: Array.isArray(options.dentists) ? options.dentists : [],
    clinic: clinicFrom(options.clinic),
  };
}

function keywordHits(normalized, keywords) {
  return keywords.filter((keyword) => normalized.includes(keyword)).length;
}

function matchService(normalized, services) {
  let best = null;
  let bestScore = 0;
  for (const service of services) {
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

function describeService(service, lang) {
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
  const cost = formatPesos(service.estimatedCost);
  if (cost) {
    parts.push(
      pick(
        lang,
        `Estimated fee starts around ${cost}; the clinic confirms the final amount.`,
        `Tinatayang bayad mula sa ${cost}; kino-confirm ng klinika ang pinal na halaga.`
      )
    );
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

function languageInstruction(question) {
  const lang = detectLanguage(question);
  if (lang === "tl") {
    return "Reply in Filipino/Tagalog (Taglish is fine if the patient mixed English). Do not switch to English-only unless the patient wrote in English.";
  }
  return "Reply in the same language the patient used (English, Filipino/Tagalog, or mixed Taglish).";
}

function answerFromCatalog(question, servicesOrOptions) {
  const { services, dentists, clinic } = normalizeOptions(servicesOrOptions);
  const normalized = normalizeQuestion(question);
  const lang = detectLanguage(question);
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
    return { answer: describeService(service, lang), source: "catalog", language: lang };
  }

  if (
    clinicTopic &&
    (!oralTopic || keywordHits(normalized, clinicTopic.keywords) >= keywordHits(normalized, oralTopic.keywords))
  ) {
    return {
      answer: clinicTopic.build(clinic, dentists, services, lang),
      source: "faq",
      language: lang,
    };
  }

  if (oralTopic) {
    return { answer: pick(lang, oralTopic.en, oralTopic.tl), source: "oral-health", language: lang };
  }

  if (ORAL_FALLBACK_RE.test(normalized)) {
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

function clinicContextBlock(clinic, services, dentists) {
  const serviceLines = services
    .map((service) => {
      const cost = formatPesos(service.estimatedCost);
      const duration = service.durationMinutes ? `${service.durationMinutes} min` : "";
      return `- ${service.name}: ${service.description || ""} ${duration} ${cost ? `from about ${cost}` : ""}`.trim();
    })
    .join("\n");
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
${dentistLines || "(assigned by the clinic)"}`;
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

async function answerWithOptionalGemini(question, servicesOrOptions) {
  const options = normalizeOptions(servicesOrOptions);
  const local = answerFromCatalog(question, options);
  const apiKey = process.env.GEMINI_API_KEY;
  const normalized = normalizeQuestion(question);
  const clinicIntent = Boolean(matchTopic(normalized, CLINIC_TOPICS));
  const oralIntent =
    Boolean(matchTopic(normalized, ORAL_HEALTH_TOPICS)) || ORAL_FALLBACK_RE.test(normalized);

  // Clinic facts stay on the local catalog so hours, phone, and fees are not invented.
  if (!apiKey || (clinicIntent && !oralIntent)) {
    return { ...local, model: "clinic-faq" };
  }

  try {
    const prompt = `You are the patient assistant for ${options.clinic.name} in the DentaSync portal.
Answer clearly about teeth, oral health, and this clinic.
You must NOT diagnose diseases, identify a patient's specific condition from symptoms, or prescribe treatment.
If asked for a diagnosis, refuse and suggest booking an oral examination or calling the clinic.
Keep answers brief (about 80-140 words). Use the clinic facts below when the question is about location, hours, contact, services, or dentists.
${languageInstruction(question)}

${clinicContextBlock(options.clinic, options.services, options.dentists)}

Patient question: ${question}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      return { ...local, model: "clinic-faq-fallback" };
    }

    const payload = await response.json();
    const text =
      payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() ||
      local.answer;

    const note = pick(
      local.language,
      "Note: General information only — not a professional dental diagnosis.",
      "Tandaan: Pangkalahatang impormasyon lang — hindi propesyonal na diagnosis sa ngipin."
    );

    return {
      answer: `${text}\n\n${note}`,
      source: "gemini",
      model: "gemini-1.5-flash",
      language: local.language,
    };
  } catch {
    return { ...local, model: "clinic-faq-fallback" };
  }
}

module.exports = {
  DEFAULT_CLINIC,
  answerFromCatalog,
  answerWithOptionalGemini,
  loadClinicProfile,
  detectLanguage,
};
