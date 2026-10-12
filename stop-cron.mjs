import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.existsSync('.env.local') ? '.env.local' : '.env';
const content = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Check what names look like
const { data: sample } = await supabase
  .from('email_deliveries')
  .select(`
    id,
    recipient_email,
    notifications:notification_id (
      student_id,
      students:student_id (full_name)
    )
  `)
  .eq('status', 'queued')
  .limit(5);

console.log('Sample queued emails with student names:');
console.log(JSON.stringify(sample, null, 2));
