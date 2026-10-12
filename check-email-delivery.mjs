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

async function check() {
  console.log('=== EMAIL DELIVERY STATUS ===\n');
  
  const { count: total } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true });
  
  const { count: queued } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued');
  
  const { count: sent } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent');
  
  const { count: withProviderId } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .not('provider_message_id', 'is', null);
  
  console.log(`Total emails: ${total}`);
  console.log(`  Queued: ${queued}`);
  console.log(`  Sent: ${sent}`);
  console.log(`  Confirmed in Resend (provider_message_id): ${withProviderId || 0}`);
  
  console.log('\n=== PROBLEM ===');
  console.log(`${sent} emails marked as "sent" but ${withProviderId || 0} confirmed by Resend`);
  console.log(`This means emails are NOT actually being delivered to Resend`);
  
  // Check if cron is running
  const { data: recentSent } = await supabase
    .from('email_deliveries')
    .select('updated_at')
    .eq('status', 'sent')
    .order('updated_at', { ascending: false })
    .limit(1);
  
  if (recentSent?.[0]) {
    const lastSent = new Date(recentSent[0].updated_at);
    const minutesAgo = Math.floor((Date.now() - lastSent.getTime()) / 60000);
    console.log(`\nLast email marked "sent": ${minutesAgo} minutes ago`);
  }
}

check().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
