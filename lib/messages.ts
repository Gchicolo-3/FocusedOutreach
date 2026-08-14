import { Lead, Broker, Partner, PartnerType } from '@/types';

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName;
}

// ========== LEAD MESSAGES (prospects) ==========

const leadTemplates: Record<string, string[]> = {
  // Call entries are guidance George reads before dialing, not messages that
  // get sent. Everything else is paste-ready. Leads are end user companies,
  // so this whole group is client prospecting: plain language, no unexplained
  // CRE shorthand.
  '1-call': [
    'Call {firstName}. {broker} connected you, so lead with that. Ask where they are on {opportunity} and offer to walk the space with them before anything gets signed.',
    'Ring {firstName}. {broker} made the intro on {opportunity}. Keep it short: offer to check what the landlord is actually agreeing to build out before they commit.',
  ],
  '1-text': [
    "Hey {firstName}, George from Focus Studio. {broker} mentioned you're working on {opportunity}. We help teams pin down cost, layout, and timeline before they commit to a space. Worth a quick call this week?",
    "Hey {firstName}, {broker} passed along your info on {opportunity}. We walk the space with you and check what the landlord's actually agreeing to build out, so there are no surprises after you sign. Quick call this week?",
  ],
  '1-email': [
    "Subject: Quick intro via {broker}\n\nHey {firstName},\n\n{broker} mentioned you're evaluating space for {opportunity}. I'm with Focus Studio, we design, build, and furnish office space under one roof, and we get involved before the lease signs, checking the space and the landlord's buildout commitments against what your team actually needs.\n\nIt catches expensive problems while they're still cheap to fix.\n\nDo you have 10 minutes this week to talk through where things stand?\n\nBest,\nGeorge",
  ],
  '1-linkedin': [
    'Hey {firstName}, {broker} suggested we connect. I run business development at Focus Studio, we help companies get clarity on cost and layout before a lease signs. Can I share how that could help with {opportunity}?',
  ],
  '2-call': [
    'Follow up with {firstName} at {company} on {opportunity}. Ask where the space search stands and offer to review the landlord proposal or layout before they sign anything.',
  ],
  '2-text': [
    "Hey {firstName}, checking where things stand with {opportunity}. If you're narrowing down options, we can pressure test the top space before you commit, cost, layout, what the landlord will actually deliver. Want me to take a look?",
  ],
  '2-email': [
    "Subject: {opportunity}, next step\n\nHey {firstName},\n\nFollowing up on {opportunity}. If the search is still active, we can review your top option against what your team actually needs, layout, cost, and what the landlord is agreeing to deliver, before anything gets signed.\n\nIt usually surfaces the expensive surprises early enough to fix them.\n\nWant me to take a look at the front runner?\n\nBest,\nGeorge",
  ],
  '2-linkedin': [
    'Hey {firstName}, following up on {opportunity}. Happy to share a couple of recent projects close to what you\'re weighing. Want me to send them over?',
  ],
  '3-call': [
    'Cold call {firstName} at {company}. Introduce Focus Studio, design, build, and furniture under one roof, and ask if they have any space decisions coming up.',
  ],
  '3-text': [
    'Hey {firstName}, George Chicolo from Focus Studio. We design, build, and furnish office space for companies across northern NJ, and we help teams get certain a space will work before they sign for it. Any space decisions on the horizon for {company}?',
  ],
  '3-email': [
    "Subject: {company}'s next space decision\n\nHey {firstName},\n\nI'm George with Focus Studio, a workplace interiors firm in Berkeley Heights. We design, build, and furnish office space under one roof, and we get involved before a lease signs, checking the space and the landlord's buildout commitments against what your team actually needs.\n\nMost companies only make this decision every several years. We do it every week, so the unknowns get answered fast.\n\nIf {company} has a move or renewal coming up, worth a quick call?\n\nBest,\nGeorge",
  ],
  '3-linkedin': [
    'Hey {firstName}, I help companies figure out cost, layout, and timeline on office space before they commit to it. If {company} is weighing options, worth a quick chat?',
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
  "Hey {firstName}, thanks again for the work we've done together. If any of your tenants have a test fit or work letter in hand right now, happy to give it a look before they sign. Anything moving in your pipeline?",
  // Week 2: Market intel ask
  "Hey {firstName}, I'm seeing decent movement in the market lately. Curious what you're seeing out there at {firmName}, anything happening on the office side?",
  // Week 3: Specific project reference
  'Hey {firstName}, just wrapped a buildout that came out great, made me think of your deals at {firmName}. Happy to send photos. Anything in your pipeline where design build could help?',
  // Week 4: Coffee ask
  "Hey {firstName}, been a minute. I've got some new work to show you and always like hearing what's moving at {firmName}. Coffee this week or next?",
];

const brokerNurtureEmails: string[] = [
  "Subject: Test fits and work letters, send them my way\n\nHey {firstName},\n\nThanks again for the work we've done together. If any of your tenants are working through a test fit or a landlord work letter right now, I'm glad to review it before they sign. It catches problems while they're still cheap to fix and keeps your deal moving.\n\nAnything in the pipeline this month?\n\nBest,\nGeorge",
  "Subject: What are you seeing in the market?\n\nHey {firstName},\n\nCurious what you're seeing out there, feels like the market is shifting. If any of your tenants are on the fence about a space, a quick review of the test fit and work letter usually gets them to a decision faster, in either direction.\n\nWhat's moving at {firmName} these days?\n\nBest,\nGeorge",
  "Subject: Recent buildout you'd appreciate\n\nHey {firstName},\n\nJust finished a buildout that came out great and made me think of the deals we've worked together. Happy to send photos, it might spark something for a current tenant.\n\nAnything in your pipeline where design build or furniture could help?\n\nBest,\nGeorge",
  "Subject: Coffee this week?\n\nHey {firstName},\n\nLet's catch up over coffee. I have some new work to show you and always enjoy hearing what you're working on at {firmName}.\n\nAre you free this week or next?\n\nBest,\nGeorge",
];

const brokerLinkedInMessages: string[] = [
  'Hey {firstName}, if any of your tenants at {firmName} are working through a test fit or work letter, glad to give it a look before they sign. Anything moving right now?',
  'Hey {firstName}, overdue for a catch up. Any interesting deals moving at {firmName} lately?',
  '{firstName}, saw some activity in the market and thought of you. Anything on the office side where design build or furniture help would move a deal along?',
  'Hey {firstName}, always glad to help on deals when I can. Does coffee or a quick call work in the next couple weeks?',
];

function getWeekIndex(lastTouch: string): number {
  if (!lastTouch) return 0;
  const d = new Date(lastTouch);
  if (isNaN(d.getTime())) return 0;
  const weeks = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 7));
  // A future lastTouch yields negative weeks; `weeks % 4` would then be a
  // negative array index (undefined template -> ".replace of undefined" crash
  // that took down the whole contact queue). Clamp so it never goes negative.
  return Math.max(0, weeks);
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
    'Hey {firstName}, hope business is good. If any of your clients are working through a lease or an office move, happy to be a second set of eyes before they sign anything. Lunch in the next couple weeks?',
  accountant:
    "Hey {firstName}, hope tax season didn't wreck you. If any of your clients are planning a move or a renovation, we handle the whole thing, design, build, and furniture under one roof. Coffee sometime this month?",
  property_manager:
    'Hey {firstName}, hope the buildings are running smooth. We handle design, build, and furniture under one roof for tenant fit outs, good for the building and good for retention. Any tenants coming or going who could use a hand?',
  networking:
    'Hey {firstName}, good connecting recently. I help companies figure out if an office space will actually work, cost, layout, timeline, before they commit to it. If someone in your world hits that situation, will you keep me in mind?',
  past_client:
    "Hey {firstName}, hope the space is treating you well! We're here if you ever want to refresh anything or someone in your network is planning a move. How's everything holding up?",
  other:
    "Hey {firstName}, if you or anyone in your network starts thinking about office space or a move, I'm glad to help them see it clearly before they commit. Coffee one of these weeks?",
};

const partnerEmailTemplates: Record<PartnerType, string> = {
  attorney:
    "Subject: Second set of eyes on client leases\n\nHey {firstName},\n\nHope you're doing well. As your clients work through leases and office moves, I'm glad to be a second set of eyes before they sign, we check the space and what the landlord's agreeing to build against what they actually need, which catches expensive problems early.\n\nAre you free for lunch in the next couple of weeks?\n\nBest,\nGeorge",
  accountant:
    "Subject: Clients planning a move this year?\n\nHey {firstName},\n\nHope things are steady at {company}. If any of your clients are weighing a move, a renovation, or new space, we walk the whole decision with them, whether the space works, what it will really cost, and then the buildout itself, design, build, and furniture under one roof.\n\nCoffee soon?\n\nBest,\nGeorge",
  property_manager:
    "Subject: Tenant fit outs whenever you need them\n\nHey {firstName},\n\nHope all is well at {company}. Whenever tenants are moving in, moving out, or renegotiating, we handle the fit out side, design, build, and furniture under one roof. It keeps deals moving and tenants happy.\n\nAnything on the horizon this quarter?\n\nBest,\nGeorge",
  networking:
    "Subject: Good connecting\n\nHey {firstName},\n\nGood connecting with you recently. Focus Studio helps companies get certain about office space before they commit, whether the space will work, what it will really cost, and what the landlord is actually agreeing to deliver.\n\nIf you come across someone navigating a move or a lease, will you send them my way?\n\nBest,\nGeorge",
  past_client:
    "Subject: Thinking of you\n\nHey {firstName},\n\nHope the space is still treating you well! We're here if you ever want to refresh anything, and if anyone in your network is planning a move, I'm glad to help them the way we helped you.\n\nAlways grateful for the work we did together. How's the team liking the space?\n\nBest,\nGeorge",
  other:
    "Subject: Staying in touch\n\nHey {firstName},\n\nHope things are going well at {company}. If you or anyone in your network ends up working on an office move or a space decision, we handle the whole thing, design, build, and furniture under one roof, and we get involved before anything is signed.\n\nCoffee one of these weeks?\n\nBest,\nGeorge",
};

const partnerLinkedInTemplates: Record<PartnerType, string> = {
  attorney: 'Hey {firstName}, hope things are well at {company}. If a client hits a tricky lease or office move, glad to be a second set of eyes before they sign. Keep me in mind?',
  accountant: 'Hey {firstName}, hope all is going well. If any of your clients start planning a move or new space, glad to help them see the whole picture first. Keep me in mind?',
  property_manager: 'Hey {firstName}, glad to help any tenants at {company} on the fit out side, design, build, and furniture under one roof. Anything on the horizon?',
  networking: 'Hey {firstName}, good to connect. If you run into anyone weighing an office decision, will you send them my way?',
  past_client: "Hey {firstName}, hope the space is still treating you well! Anything you'd want to refresh this year?",
  other: "Hey {firstName}, if anyone around you starts thinking about office space, I'm glad to help them get clear before they commit. Keep me in mind?",
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

// Mirrors the cold broker text template in docs/voice.md, the canonical
// default for this exact situation.
export function getColdBrokerIntro(brokerName: string, firm: string): string {
  const first = firstName(brokerName);
  return `Hey ${first}, George Chicolo from Focus Studio. We work with brokers across NJ on the design, build, and furniture side when their tenants are getting into a new space. Coffee sometime to see if there's a fit to work together on deals down the line at ${firm}?`;
}
