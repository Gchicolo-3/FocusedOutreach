export type ContactType = 'prospect' | 'broker' | 'referral_partner' | 'uncategorized';
export type RelationshipTier = 'A' | 'B' | 'C';
// Single field that drives every tab: moving a record between buckets is one
// update. 'blast_only' mirrors the Salesforce D-tier logic (no cadence).
export type Bucket = 'active' | 'cold' | 'not_worth_pursuing' | 'blast_only';
export type Channel = 'call' | 'text' | 'email' | 'linkedin';
export type PartnerType =
  | 'attorney'
  | 'accountant'
  | 'property_manager'
  | 'networking'
  | 'past_client'
  | 'other';

export type Lead = {
  id: string;
  company: string;
  contact: string;
  subject: string;
  activityType: string;
  date: string;
  status: string;
  priority: string;
  comments: string;
  tier: 1 | 2 | 3;
  broker?: string;
  channel: Channel;
  lastTouch?: string;
  nextDue?: string;
  email?: string;
  phone?: string;
  dismissed?: boolean;
  bucket?: Bucket;
  // $200k+ end-user targets (Littler Mendelson scale) vs standard prospects.
  isEnterprise?: boolean;
};

export type Broker = {
  id: string;
  firstName: string;
  lastName: string;
  firm: string;
  title: string;
  email?: string;
  phone?: string;
  mobile?: string;
  linkedin?: string;
  tier: RelationshipTier;
  dealCount: number;
  dealNames: string[];
  lastTouch: string;
  nextDue: string;
  notes: string;
  status: 'overdue' | 'due_soon' | 'on_track';
  dismissed?: boolean;
  bucket?: Bucket;
  persona?: string | null;
};

export type Partner = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  partnerType: PartnerType;
  tier: RelationshipTier;
  referralCount: number;
  lastTouch: string;
  nextDue: string;
  notes: string;
  email?: string;
  phone?: string;
  dismissed?: boolean;
  bucket?: Bucket;
  persona?: string | null;
};

export type ColdBroker = {
  id: string;
  name: string;
  title: string;
  firm: string;
  email: string;
  phone: string;
  mobile?: string;
  linkedin?: string;
  status: 'new' | 'outreach_sent' | 'connected' | 'active_broker';
  dismissed?: boolean;
};

export type UncategorizedContact = {
  id: string;
  company: string;
  contact: string;
  comments: string;
};

export type DoneEntry = { id: string; date: string };
export type SnoozedEntry = { id: string; until: string };
export type NoteEntry = { id: string; text: string };
export type TouchLogEntry = { id: string; date: string; channel: Channel };
export type UserTag = { id: string; type: ContactType; tier?: RelationshipTier };

export type SequenceStep = {
  day: number;
  channel: Channel;
  auto: boolean;
  message: string;
};

export type Sequence = {
  name: string;
  totalDays: number;
  steps: SequenceStep[];
};

export type DailyTask = {
  id: string;
  score: number;
  source: 'broker' | 'partner' | 'prospect' | 'cold_broker';
  label: string;
  name: string;
  company: string;
  channel: Channel;
  tier?: RelationshipTier;
  leadTier?: 1 | 2 | 3;
  context: string;
  message: string;
  email?: string;
  phone?: string;
  broker?: string;
  subject?: string;
  intel?: string;
  lastTouch?: string;
};
