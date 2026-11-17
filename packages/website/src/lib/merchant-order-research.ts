type Question = {
  key: string;
  label: string;
  options?: string[];
  maxChoices?: number;
  optional?: boolean;
  short?: boolean;
};

export type Answers = Record<string, string | string[]>;

export const sections = ["About your business", "How you take orders", "An idea to try", "Follow-up"];

export const concept = "A customer sends an order request through Akiba. You check availability and confirm the total. The customer pays your business directly, before dispatch or at handover. For M-Pesa, they submit their transaction code in Akiba and you check it against your own records. An inbox shows which orders need a response, payment confirmation, or fulfilment. Customers find your shop in Akiba, earn AkibaMiles on eligible completed orders, and can use vouchers. You get paid directly. Akiba never handles the money.";

export function questions(step: number, answers: Answers): Question[] {
  if (step === 0) return [
      { key: "category", label: "What do you sell?", options: ["Food and drinks", "Clothing and accessories", "Beauty and wellness", "Home and gifts", "Electronics", "Services", "Other"] },
      { key: "shopType", label: "How do you sell to customers?", options: ["Physical shop only", "Online only", "Physical shop and online"] },
  ];

  if (step === 1) {
    const base: Question[] = [
      { key: "channels", label: "Where do customers place orders without visiting in person?", maxChoices: 8, options: ["WhatsApp", "Instagram or Facebook", "Phone calls or SMS", "Our own website", "Marketplace or delivery app", "Other", "We don’t take remote orders"] },
    ];
    if (Array.isArray(answers.channels) && answers.channels.includes("We don’t take remote orders")) {
      return [...base, { key: "barrier", label: "What’s the main reason you don’t take remote orders?", options: ["Low demand", "Our products or services need an in-person visit", "Delivery", "Staffing", "Payment or refund concerns", "Other"] }];
    }
    return [
      ...base,
      { key: "volume", label: "About how many remote orders did you complete in the last 30 days?", options: ["None", "1–5", "6–20", "21–50", "51 or more", "I’m not sure"] },
      ...(answers.volume === "None" ? [] : [{ key: "example", label: "Think about the last remote order that took extra effort. What happened?", optional: true }]),
      { key: "problems", label: "Which parts take the most time or cause the most problems?", maxChoices: 2, options: ["Answering product or availability questions", "Keeping track of orders", "Confirming stock or delivery fees", "Matching payments to orders", "Customers sending fake or wrong M-Pesa messages", "Arranging delivery or pickup", "Cancellations, returns, or refunds", "Discounts or loyalty rewards", "Other", "Our current process works well"] },
      { key: "paymentTiming", label: "When do customers usually pay?", options: ["Before dispatch", "At delivery or pickup", "It depends on the order", "Other"] },
      { key: "paymentAccounts", label: "What accounts or methods do customers use to pay you?", maxChoices: 6, options: ["Till (Buy Goods)", "Paybill", "Personal M-Pesa number (Send Money)", "Bank or card", "Cash only", "Cash alongside other methods", "Other"] },
      { key: "delivery", label: "Who handles delivery or pickup?", maxChoices: 5, options: ["Our own staff", "A boda rider we call", "A courier service", "The customer collects", "We don’t deliver"] },
      { key: "paymentChecks", label: "How do you usually confirm payment?", maxChoices: 5, options: ["Check our M-Pesa messages or statement", "Check another payment system", "Collect cash at handover", "Ask the buyer for proof", "Other"] },
    ];
  }

  if (step === 2) return [
    { key: "intent", label: "If this were available next week, what would you do?", options: ["Try it with one or two real orders", "List a few products and see if customers order", "Consider it if it fits how I already take orders", "Keep using my current process", "I’m not sure yet"] },
    { key: "conditions", label: answers.intent === "Keep using my current process" ? "What makes your current process work better for you?" : "What would have to be true for you to use this for a real order?", optional: true },
    { key: "catalogue", label: "How would you prefer to add and maintain your products?", options: ["Add products one at a time on my phone", "Upload a CSV or Excel sheet and add photos afterward", "Use a catalogue I already maintain elsewhere", "Take requests without a product list", "Other"] },
    { key: "rewards", label: "Which discounts would you consider offering on orders through Akiba?", maxChoices: 2, options: ["A percentage off the order", "A fixed amount off the order", "Free or discounted delivery", "A first-order discount", "No discounts for now", "I’d need to understand the cost first"] },
    ...(Array.isArray(answers.rewards) && answers.rewards.includes("I’d need to understand the cost first") ? [
      { key: "rewardBudget", label: "Roughly what share of an order would you put toward a discount?", options: ["0%", "1–3%", "4–7%", "8%+"] },
    ] : []),
  ];

  return [
    { key: "followUp", label: "Would you be open to a follow-up or trying a real order?", options: ["Try an order", "Short follow-up", "Both", "Neither"] },
    ...(answers.followUp && answers.followUp !== "Neither" ? [
      { key: "business", label: "Business name", short: true, optional: true },
      { key: "contact", label: "WhatsApp number or email", short: true, optional: true },
    ] : []),
  ];
}

export const exclusiveChoices = ["We don’t take remote orders", "Our current process works well", "No discounts for now", "I’d need to understand the cost first", "Cash only"];

export function validateStep(step: number, answers: Answers, visibleKeys?: readonly string[]) {
  for (const question of questions(step, answers)) {
    if (visibleKeys && !visibleKeys.includes(question.key)) continue;
    const value = answers[question.key];
    const valid = question.maxChoices
      ? Array.isArray(value) && value.length > 0 && value.length <= question.maxChoices &&
        new Set(value).size === value.length && value.every((item) => question.options?.includes(item)) &&
        (value.length === 1 || !value.some((item) => exclusiveChoices.includes(item)))
      : typeof value === "string" && (question.options
        ? question.options.includes(value)
        : (question.optional || Boolean(value.trim())) && value.length <= (question.short ? 254 : 1200));
    if (!valid && !(question.optional && value === undefined)) return question;
  }
  return null;
}

export function merchantInviteId(value: unknown) {
  return typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export const surveyCohorts = ["online-hybrid", "physical-only", "external-seller"];

export function createResearchSubmissionId(random: { getRandomValues: (bytes: Uint8Array) => Uint8Array } = crypto) {
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
