export interface QuranVerse {
  id: number;
  surah_no: number;
  surah_name: string;
  ayah_no: number;
  ayah_text: string;
  has_links: boolean;
  links_count: number;
  is_protected: boolean;
  created_at: string;
  updated_at: string;
}

export type LinkTypeValue = 'wajih' | 'sifa' | 'mutashabihat' | 'sabab_nuzul' | 'fawaaid' | 'lafdhi' | 'adadi' | 'maqam' | 'takrir';
export type LinkStatus = 'pending' | 'approved' | 'rejected';

export interface AyahLink {
  id: number;
  verse_id: number;
  link_types: string[];
  link_content: string;
  link_title: string | null;
  audio_url: string | null;
  synthetic_audio_url: string | null;
  voice_type: 'male' | 'female' | null;
  original_transcript: string | null;
  status: LinkStatus;
  rephrase_command: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RephrasedContent {
  id: number;
  verse_id: number | null;
  original_text: string;
  rephrased_text: string;
  status: 'pending' | 'approved' | 'rejected';
  created_by: string | null;
  created_at: string;
}

export type VerseFilter = 'all' | 'green' | 'red';

export type VoiceType = 'majood' | 'muhdar' | 'ameeq' | 'moalima' | 'waqoor';

export interface VoiceOption {
  id: VoiceType;
  label: string;
  gender: 'male' | 'female';
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'majood', label: 'مجوّد', gender: 'male' },
  { id: 'muhdar', label: 'محاضر', gender: 'male' },
  { id: 'ameeq', label: 'عميق', gender: 'male' },
  { id: 'moalima', label: 'معلمة', gender: 'female' },
  { id: 'waqoor', label: 'وقور', gender: 'female' },
];

export const LINK_TYPES = [
  { value: 'wajih', label: 'وجه' },
  { value: 'sifa', label: 'صفة' },
  { value: 'mutashabihat', label: 'متشابهات' },
  { value: 'sabab_nuzul', label: 'سبب نزول' },
  { value: 'fawaaid', label: 'فوائد' },
  { value: 'lafdhi', label: 'لفظي' },
  { value: 'adadi', label: 'عددي' },
  { value: 'maqam', label: 'مقام' },
  { value: 'takrir', label: 'تكرار' },
] as const;

export const LINK_TYPE_HINTS: Record<string, string> = {
  wajih: 'وجه البلاغة أو دقة الأداء',
  sifa: 'صفة الحرف أو الكلمة',
  mutashabihat: 'آية متشابهة في اللفظ أو المعنى',
  sabab_nuzul: 'سبب نزول الآية',
  fawaaid: 'فوائد ولطائف تعين على الحفظ',
  lafdhi: 'تشابه لفظي أو تناسق حروف',
  adadi: 'رقم أو عدد مميز',
  maqam: 'مقام القراءة أو الوقف',
  takrir: 'تكرار كلمة أو آية',
};

export const TOTAL_VERSES = 6236;
