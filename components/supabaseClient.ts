import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cktnqsijfwcyjkujsulw.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrdG5xc2lqZndjeWprdWpzdWx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MzIyNTUsImV4cCI6MjA4MDUwODI1NX0.w3yP5JpLOJf3jsf0Kti9YSfY69IH2ltuD-1R0y4hnqc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);