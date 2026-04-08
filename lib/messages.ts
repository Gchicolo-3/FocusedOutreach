import { Lead, Broker } from '@/types';

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName;
}

// Lead message templates by tier + channel
const leadTemplates: Record<string, string[]> = {
  '1-call': [
    'Call {firstName} — {broker} connected you. Reference {opportunity} and offer a quick visual of the space.',
    'Ring {firstName}. {broker} made the intro on {opportunity}. Keep it short — offer to show what the space could look like.',
  ],
  '1-text': [
    'Hey {firstName} — {broker} mentioned you\'re working on {opportunity}. Wanted to reach out directly — I help teams see exactly how a space will work before they commit. Worth a quick chat?',
    'Hi {firstName}, {broker} passed along your info re: {opportunity}. We do space visualization that helps tenants pull the trigger faster. Happy to show you a quick example.',
  ],
  '1-email': [
    'Subject: Quick intro via {broker}\n\nHi {firstName},\n\n{broker} mentioned you\'re evaluating space for {opportunity}. At Focus Studio, we create photorealistic renderings that help teams visualize exactly how a space will work — before the lease is signed.\n\nWould love to show you a quick example. Do you have 10 minutes this week?\n\nBest,\nGeorge',
    'Subject: {broker} suggested I reach out\n\nHi {firstName},\n\nI work with {broker} regularly — they mentioned {opportunity} might be on your radar. We help tenants see their space before they commit through 3D visualization.\n\nHappy to share a 2-minute example. When works for a quick call?\n\nGeorge',
  ],
  '1-linkedin': [
    'Hi {firstName} — {broker} suggested we connect. I run Focus Studio, where we help tenants visualize space before signing. Would love to share how it could help with {opportunity}.',
    '{firstName} — connected through {broker}. We do 3D space visualization for commercial tenants. Thought it might be relevant to {opportunity}. Happy to chat if you\'re interested.',
  ],
  '2-call': [
    'Follow up with {firstName} at {company} about {opportunity}. Check on timeline and offer updated renderings.',
    'Call {firstName} — it\'s been a while since your last touch on {opportunity}. Re-engage with a value add.',
  ],
  '2-text': [
    'Hey {firstName} — wanted to circle back on {opportunity}. Any updates on the space search? Happy to put together a quick visual if you\'re narrowing down options.',
    'Hi {firstName}, checking in on {opportunity}. If you\'re still evaluating spaces, I can show you what the top options would look like built out. Quick and free.',
  ],
  '2-email': [
    'Subject: Following up — {opportunity}\n\nHi {firstName},\n\nWanted to check in on {opportunity}. If the space search is still active, we can put together a quick rendering of your top 1-2 options — helps the decision-making process significantly.\n\nLet me know if you\'d like to see an example.\n\nBest,\nGeorge',
  ],
  '2-linkedin': [
    'Hey {firstName} — following up on our earlier conversation about {opportunity}. Happy to share some recent work that might be relevant to your search.',
  ],
  '3-call': [
    'Cold call {firstName} at {company}. Introduce Focus Studio and gauge interest in space visualization.',
  ],
  '3-text': [
    'Hi {firstName} — George from Focus Studio. We help companies see exactly how a space will work before they commit to a lease. If {company} is evaluating new space, I\'d love to show you what we do.',
  ],
  '3-email': [
    'Subject: Helping {company} visualize your next space\n\nHi {firstName},\n\nI\'m George from Focus Studio. We create photorealistic renderings that help tenants see how a space will work before signing.\n\nIf {company} is looking at new space, I\'d love to show you a quick example.\n\nBest,\nGeorge',
  ],
  '3-linkedin': [
    'Hi {firstName} — I help commercial tenants visualize space before they sign. If {company} is exploring options, would love to connect.',
  ],
};

export function getLeadMessage(lead: Lead): string {
  const key = `${lead.tier}-${lead.channel}`;
  const templates = leadTemplates[key] || leadTemplates[`${lead.tier}-text`] || ['Follow up with {firstName} at {company}.'];
  // Rotate based on lead id hash
  const hash = lead.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const template = templates[hash % templates.length];

  return template
    .replace(/\{firstName\}/g, firstName(lead.contact))
    .replace(/\{company\}/g, lead.company)
    .replace(/\{broker\}/g, lead.broker || 'a mutual contact')
    .replace(/\{opportunity\}/g, lead.subject || 'your space search');
}

// Broker nurture templates — 4 rotating based on weeks since last touch
const brokerNurtureTexts: string[] = [
  'Hey {brokerFirst} — wanted to say thanks again for the {company} intro. If you have any other tenants evaluating space, I can turn around renderings in 48 hours. Always happy to help your deals close faster.',
  'Hey {brokerFirst} — seeing a lot of activity in the market right now. Curious what you\'re hearing on your end? If any of your tenants need help visualizing space, I\'m always around.',
  'Hey {brokerFirst} — just wrapped a project similar to that {company} deal. Came out great. If you have anything in the pipeline where visuals could help, let me know.',
  'Hey {brokerFirst} — been a minute. Would love to grab coffee and catch up. I\'ve got some new work to show you and always like hearing what you\'re working on. You free this week or next?',
];

const brokerNurtureEmails: string[] = [
  'Subject: Quick thank you + availability\n\nHi {brokerFirst},\n\nWanted to follow up on the {company} connection — really appreciate you thinking of us. Just a heads up that I have availability this month if any of your tenants need space visualization.\n\nTurnaround is typically 48 hours and it\'s completely free for the tenant — makes your deals close faster.\n\nBest,\nGeorge',
  'Subject: What are you seeing in the market?\n\nHi {brokerFirst},\n\nCurious what you\'re hearing out there — seems like the market is shifting. If any of your tenants are on the fence about a space, our renderings can help them pull the trigger.\n\nAlways happy to be a resource for your deals.\n\nBest,\nGeorge',
  'Subject: Recent project that reminded me of your deals\n\nHi {brokerFirst},\n\nJust finished a project that reminded me of the work we did together. Happy to share if you\'re interested — it might spark an idea for a current deal.\n\nLet me know if you have anything in the pipeline where visuals could help.\n\nBest,\nGeorge',
  'Subject: Coffee this week?\n\nHi {brokerFirst},\n\nIt\'s been a while — would love to catch up over coffee. I have some new work to show you and always enjoy hearing what you\'re working on.\n\nAre you free this week or next?\n\nBest,\nGeorge',
];

export function getBrokerNurtureText(broker: Broker): string {
  const weekIndex = getWeekIndex(broker.lastTouch);
  const template = brokerNurtureTexts[weekIndex % 4];
  return template
    .replace(/\{brokerFirst\}/g, firstName(broker.name))
    .replace(/\{company\}/g, broker.firm);
}

export function getBrokerNurtureEmail(broker: Broker): string {
  const weekIndex = getWeekIndex(broker.lastTouch);
  const template = brokerNurtureEmails[weekIndex % 4];
  return template
    .replace(/\{brokerFirst\}/g, firstName(broker.name))
    .replace(/\{company\}/g, broker.firm);
}

function getWeekIndex(lastTouch: string): number {
  if (!lastTouch) return 0;
  const d = new Date(lastTouch);
  if (isNaN(d.getTime())) return 0;
  const weeks = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 7));
  return weeks;
}

// Cold broker intro templates
export function getColdBrokerIntro(brokerName: string, firm: string): string {
  const first = firstName(brokerName);
  return `Hey ${first} — George Chicolo here from Focus Studio. I work with a handful of brokers in the area doing free 3D space renderings for their tenant clients. Helps tenants visualize the space and pulls the trigger faster on deals. Would love to be a resource for your deals at ${firm}. Worth a quick chat?`;
}
