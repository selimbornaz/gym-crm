export type ChatChannel = "whatsapp" | "instagram" | "messenger" | "simulator";
export type ChatStatus = "bot" | "human" | "closed";
export type ChatSender = "contact" | "bot" | "staff" | "system";

export interface ChatbotSettings {
  organization_id: string;
  enabled: boolean;
  bot_name: string;
  tone: string;
  welcome_message: string | null;
  knowledge: string;
  handoff_message: string;
  allow_member_info: boolean;
  allow_booking: boolean;
  allow_leads: boolean;
  human_pause_minutes: number;
}

export interface ChatConversation {
  id: string;
  organization_id: string;
  channel: ChatChannel;
  account_id: string | null;
  external_user_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  member_id: string | null;
  lead_id: string | null;
  status: ChatStatus;
  needs_human: boolean;
  bot_paused_until: string | null;
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: ChatSender;
  body: string;
  staff_user_id: string | null;
  delivery_error: string | null;
  created_at: string;
}

export const DEFAULT_SETTINGS: Omit<ChatbotSettings, "organization_id"> = {
  enabled: false,
  bot_name: "Assistant Dopamine Fitness",
  tone: "chaleureux, motivant et professionnel",
  welcome_message: null,
  knowledge: "",
  handoff_message: "Un membre de l'équipe va vous répondre très vite.",
  allow_member_info: true,
  allow_booking: true,
  allow_leads: true,
  human_pause_minutes: 120,
};

export const CHANNEL_LABEL: Record<ChatChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  simulator: "Simulateur",
};
