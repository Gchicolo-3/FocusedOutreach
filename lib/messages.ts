import { Lead, Broker, Partner, PartnerType } from '@/types';

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName;
}

// ========== LEAD MESSAGES (prospects) ==========

const leadTemplates: Record<string, string[]> = {
  '1-call': [
    'Call {firstName} — {broker} connected you. Reference {opportunity} and offer a quick visual of the space.',
    'Ring {firstName}. {broker} made the intro on {opportunity}. Keep it short — offer to show what the space could look like.',
  ],
  '1-text': [
    "Hey {firstName} — {broker} mentioned you're working on {opportunity}. Wanted to reach out directly — I help teams see exactly how a space will work before they commit. Worth a quick chat?",
    'Hi {firstName}, {broker} passed along your info re: {opportunity}. We do space visualization that helps tenants pull the trigger faster. Happy to show you a quick example.',
  ],
  '1-email': [
    "Subject: Quick intro via {broker}\n\nHi {firstName},\n\n{broker} mentioned you're evaluating space for {opportunity}. At Focus Studio, we create photorealistic renderings that help teams visualize exactly how a space will work — before the lease is signed.\n\nWould love to show you a quick example. Do you have 10 minutes this week?\n\nBest,\nGeorge",
  ],
  '1-linkedin': [
    'Hi {firstName} — {broker} suggested we connect. I run Focus Studio, where we help tenants visualize space before signing. Would love to share how it could help with {opportunity}.',
  ],
  '2-call': [
    'Follow up with {firstName} at {company} about {opportunity}. Check on timeline and offer updated renderings.',
  ],
  '2-text': [
    "Hey {firstName} — wanted to circle back on {opportunity}. Any updates on the space search? Happy to put together a quick visual if you're narrowing down options.",
  ],
  '2-email': [
    "Subject: Following up — {opportunity}\n\nHi {firstName},\n\nWanted to check in on {opportunity}. If the space search is still active, we can put together a quick rendering of your top 1-2 options — helps the decision-making process significantly.\n\nLet me know if you'd like to see an example.\n\nBest,\nGeorge",
  ],
  '2-linkedin': [
    'Hey {firstName} — following up on our earlier conversation about {opportunity}. Happy to share some recent work that might be relevant to your search.',
  ],
  '3-call': [
    'Cold call {firstName} at {company}. Introduce Focus Studio and gauge interest in space visualization.',
  ],
  '3-text': [
    "Hi {firstName} — George from Focus Studio. We help companies see exactly how a space will work before they commit to a lease. If {company} is evaluating new space, I'd love to show you what we do.",
  ],
  '3-email': [
    "Subject: Helping {company} visualize your next space\n\nHi {firstName},\n\nI'm George from Focus Studio. We create photorealistic renderings that help tenants see how a space will work before signing.\n\nIf {company} is looking at new space, I'd love to show you a quick example.\n\nBest,\nGeorge",
  ],
  '3-linkedin': [
    'Hi {firstName} — I help commercial tenants visualize space before they sign. If {company} is exploring options, would love to connect.',
  ],
};

export function getLeadMessage(lead: Lead): string {
  const key = `${lead.tier}-${lead.channel}`;
  const templates = leadTemplates[key] || leadTemplates[`${lead.tier}-text`] || ['Follow up with {firstName} at {company}.'];
  const hash = lead.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const template = templates[hash % templates.length];

  return template
    .replace(/\{firstName\}/g, firstName(lead.contact))
    .replace(/\{company\}/g, lead.company)
    .replace(/\{broker\}/g, lead.broker || 'a mutual contact')
    .replace(/\{opportunity\}/g, lead.subject || 'your space search');
}

// ========== BROKER NURTURE ==========

const brokerNurtureTexts: string[] = [
  // Week 1: Value add
  'Hey {firstName} — wanted to say thanks again for the work we have done together. If you have any tenants evaluating space right now, I can turn around renderings in 48 hours. Always happy to help your deals close faster.',
  // Week 2: Market intel ask
  "Hey {firstName} — seeing a lot of activity in the market right now. Curious what you're hearing on your end at {firmName}? If any of your tenants need help visualizing space, I'm always around.",
  // Week 3: Specific project reference
  'Hey {firstName} — just wrapped a project that reminded me of a deal you were working on. Came out great. If you have anything in the pipeline where visuals could help, let me know.',
  // Week 4: Coffee ask
  "Hey {firstName} — been a minute. Would love to grab coffee and catch up. I've got some new work to show you and always like hearing what you're working on at {firmName}. You free this week or next?",
];

const brokerNurtureEmails: string[] = [
  'Subject: Quick thank you + availability\n\nHi {firstName},\n\nWanted to follow up and say thanks again for the work we have done together. Just a heads up that I have availability this month if any of your tenants need space visualization.\n\nTurnaround is typically 48 hours and it is completely free for the tenant — makes your deals close faster.\n\nBest,\nGeorge',
  "Subject: What are you seeing in the market?\n\nHi {firstName},\n\nCurious what you're hearing out there — seems like the market is shifting. If any of your tenants are on the fence about a space, our renderings can help them pull the trigger.\n\nAlways happy to be a resource for your deals at {firmName}.\n\nBest,\nGeorge",
  "Subject: Recent project that reminded me of your deals\n\nHi {firstName},\n\nJust finished a project that reminded me of the work we've done together. Happy to share if you're interested — it might spark an idea for a current deal.\n\nLet me know if you have anything in the pipeline where visuals could help.\n\nBest,\nGeorge",
  "Subject: Coffee this week?\n\nHi {firstName},\n\nIt's been a while — would love to catch up over coffee. I have some new work to show you and always enjoy hearing what you're working on at {firmName}.\n\nAre you free this week or next?\n\nBest,\nGeorge",
];

const brokerLinkedInMessages: string[] = [
  'Hey {firstName} — wanted to stay in touch. If any of your tenants at {firmName} need space visualization, happy to be a resource. Hope all is well.',
  'Hey {firstName} — been a while since we connected. Would love to catch up when you have a minute. Any interesting deals at {firmName} lately?',
  '{firstName} — saw some activity in the market and thought of you. Let me know if any of your tenants could use help visualizing space.',
  'Hey {firstName} — always happy to help on deals when I can. Let me know if coffee or a quick call works in the next couple weeks.',
];

function getWeekIndex(lastTouch: string): number {
  if (!lastTouch) return 0;
  const d = new Date(lastTouch);
  if (isNaN(d.getTime())) return 0;
  const weeks = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 7));
  return weeks;
}

export function getBrokerNurtureText(broker: Broker): string {
  const weekIndex = getWeekIndex(broker.lastTouch);
  const template = brokerNurtureTexts[weekIndex % 4];
  return template
    .replace(/\{firstName\}/g, broker.firstName)
    .replace(/\{firmName\}/g, broker.firm);
}

export function getBrokerNurtureEmail(broker: Broker): string {
  const weekIndex = getWeekIndex(broker.lastTouch);
  const template = brokerNurtureEmails[weekIndex % 4];
  return template
    .replace(/\{firstName\}/g, broker.firstName)
    .replace(/\{firmName\}/g, broker.firm);
}

export function getBrokerLinkedIn(broker: Broker): string {
  const weekIndex = getWeekIndex(broker.lastTouch);
  const template = brokerLinkedInMessages[weekIndex % 4];
  return template
    .replace(/\{firstName\}/g, broker.firstName)
    .replace(/\{firmName\}/g, broker.firm);
}

// ========== REFERRAL PARTNER MESSAGES ==========

const partnerTextTemplates: Record<PartnerType, string> = {
  attorney:
    "Hey {firstName} — hope business is going well. Wanted to stay in touch. If any of your clients are ever dealing with a move or office refresh, happy to be a resource. Let me know if you want to grab lunch.",
  accountant:
    "Hey {firstName} — hope tax season didn't wreck you. Wanted to stay in touch. If any of your clients are ever planning a move or renovation, always happy to be a resource. Coffee sometime?",
  property_manager:
    "Hey {firstName} — hope the properties are running smoothly. Any tenants coming or going that might need some help with their space? Always happy to put visuals together — good for the building and good for retention.",
  networking:
    "Hey {firstName} — great connecting recently. Wanted to follow up — I help companies figure out how their office space will actually work before they commit. If you ever come across someone in that situation, happy to be a resource.",
  past_client:
    "Hey {firstName} — hope the space is treating you well! Thinking of you — if you ever want to refresh anything or know someone who's planning a move, we'd love to help. Hope everything is going great.",
  other:
    "Hey {firstName} — wanted to stay in touch. If you or anyone in your network is ever thinking about office space, visualization, or a move, I'm always happy to be a resource at {company}.",
};

const partnerEmailTemplates: Record<PartnerType, string> = {
  attorney:
    "Subject: Staying in touch\n\nHi {firstName},\n\nHope you're doing well. Wanted to reach out just to stay connected. As your clients work through leases, moves, or office changes, I'm always happy to be a resource — we handle the visualization piece so they can see exactly what their space will look like before committing.\n\nHappy to grab lunch if the timing works.\n\nBest,\nGeorge",
  accountant:
    "Subject: Quick check-in\n\nHi {firstName},\n\nHope things are going well at {company}. Just wanted to stay in touch. If any of your clients are evaluating a move, renovation, or new space, I'm always happy to be a resource — we create renderings that help companies see their space before they commit.\n\nCoffee soon?\n\nBest,\nGeorge",
  property_manager:
    "Subject: Tenant support whenever you need it\n\nHi {firstName},\n\nHope all is well at {company}. Just wanted to remind you that I'm happy to help any of your tenants with space visualization when they're evaluating moves or renovations. It tends to help deals close faster and improves retention.\n\nLet me know if anything is on the horizon.\n\nBest,\nGeorge",
  networking:
    "Subject: Good to connect\n\nHi {firstName},\n\nGreat connecting with you recently. Wanted to follow up — Focus Studio helps companies visualize their office space before they sign a lease or start a build-out. If you come across anyone navigating a move or space decision, I'd love to be a resource.\n\nBest,\nGeorge",
  past_client:
    "Subject: Thinking of you\n\nHi {firstName},\n\nHope the space is still treating you well! Just wanted to say hello and let you know we're here if you ever want to refresh anything or if anyone in your network is planning a move.\n\nAlways grateful for the work we did together.\n\nBest,\nGeorge",
  other:
    "Subject: Staying in touch\n\nHi {firstName},\n\nHope things are going well at {company}. Just wanted to reach out and stay connected. If you or anyone in your network is ever working on an office move or space decision, Focus Studio is always happy to be a resource.\n\nBest,\nGeorge",
};

const partnerLinkedInTemplates: Record<PartnerType, string> = {
  attorney: "Hey {firstName} — hope things are well at {company}. Wanted to stay in touch in case any of your clients need help visualizing a space decision.",
  accountant: "Hey {firstName} — hope all is going well. Happy to be a resource for any of your clients thinking about space or a move.",
  property_manager: "Hey {firstName} — always happy to help with tenant visualization at {company}. Let me know if anything is on the horizon.",
  networking: "Hey {firstName} — good to connect. If you run into anyone evaluating office space, I'd love to be a resource.",
  past_client: "Hey {firstName} — hope the space is still treating you well! Let me know if you ever want to refresh anything.",
  other: "Hey {firstName} — wanted to stay in touch. Happy to be a resource for anyone thinking about their office space.",
};

export function getPartnerNurtureText(partner: Partner): string {
  const template = partnerTextTemplates[partner.partnerType] || partnerTextTemplates.other;
  return template
    .replace(/\{firstName\}/g, partner.firstName)
    .replace(/\{company\}/g, partner.company);
}

export function getPartnerNurtureEmail(partner: Partner): string {
  const template = partnerEmailTemplates[partner.partnerType] || partnerEmailTemplates.other;
  return template
    .replace(/\{firstName\}/g, partner.firstName)
    .replace(/\{company\}/g, partner.company);
}

export function getPartnerLinkedIn(partner: Partner): string {
  const template = partnerLinkedInTemplates[partner.partnerType] || partnerLinkedInTemplates.other;
  return template
    .replace(/\{firstName\}/g, partner.firstName)
    .replace(/\{company\}/g, partner.company);
}

// ========== COLD BROKER INTRO ==========

export function getColdBrokerIntro(brokerName: string, firm: string): string {
  const first = firstName(brokerName);
  return `Hey ${first} — George Chicolo here from Focus Studio. I work with a handful of brokers in the area doing free 3D space renderings for their tenant clients. Helps tenants visualize the space and pull the trigger faster on deals. Would love to be a resource for your deals at ${firm}. Worth a quick chat?`;
}
