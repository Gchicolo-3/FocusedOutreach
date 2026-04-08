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
  channel: 'call' | 'text' | 'email' | 'linkedin';
};

export type Broker = {
  id: string;
  name: string;
  firm: string;
  dealCount: number;
  lastTouch: string; // ISO date
  notes: string;
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
};

export type DoneEntry = {
  id: string;
  date: string; // ISO date
};

export type SnoozedEntry = {
  id: string;
  until: string; // ISO date
};

export type NoteEntry = {
  id: string;
  text: string;
};

export type SequenceStep = {
  day: number;
  channel: 'call' | 'text' | 'email' | 'linkedin';
  auto: boolean;
  message: string;
};

export type Sequence = {
  name: string;
  totalDays: number;
  steps: SequenceStep[];
};
