
export type AIMode = 'general' | 'business' | 'academic' | 'health' | 'agriculture' | 'creative';

export interface TranscriptionItem {
  role: 'user' | 'model';
  text: string;
}

export interface ModeConfig {
  id: AIMode;
  title: string;
  icon: string;
  description: string;
  instruction: string;
  color: string;
}
