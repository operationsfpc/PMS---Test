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

async function checkStatus() {
  console.log('Checking email delivery status...\n');

  const { count: queued } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued');

  const { count: sent } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent');

  const { count: failed } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed');

  const { count: withProviderId } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .not('provider_message_id', 'is', null);

  console.log('Email status breakdown:');
  console.log(`  queued: ${queued || 0}`);
  console.log(`  sent: ${sent || 0}`);
  console.log(`  failed: ${failed || 0}`);
  console.log(`\nEmails with provider_message_id (confirmed in Resend): ${withProviderId || 0}`);

  const { data: recentSent } = await supabase
    .from('email_deliveries')
    .select('id, recipient_email, status, updated_at, provider_message_id')
    .eq('status', 'sent')
    .order('updated_at', { ascending: false })
    .limit(5);

  console.log('\nMost recent "sent" emails:');
  recentSent?.forEach(e => {
    const hasProviderId = e.provider_message_id ? '✓' : '✗';
    console.log(`  ${hasProviderId} ${e.recipient_email} - ${new Date(e.updated_at).toLocaleTimeString()}`);
  });
}

checkStatus().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
