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

async function checkAll() {
  console.log('=== TOTAL EMAIL STATUS ===\n');

  const { count: total } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true });

  const { count: sent } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent');

  const { count: queued } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued');

  const { count: failed } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed');

  console.log(`Total emails: ${total}`);
  console.log(`  Sent (marked as sent): ${sent}`);
  console.log(`  Queued (waiting): ${queued}`);
  console.log(`  Failed: ${failed}`);

  // Check how many sent emails have provider_message_id (actually delivered to Resend)
  const { count: withProviderId } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent')
    .not('provider_message_id', 'is', null);

  console.log(`\n  Sent WITH provider_message_id (confirmed in Resend): ${withProviderId || 0}`);
  console.log(`  Sent WITHOUT provider_message_id (NOT confirmed): ${(sent || 0) - (withProviderId || 0)}`);

  // Check the sent emails - do they have student names?
  const { data: sentEmails } = await supabase
    .from('email_deliveries')
    .select(`
      id,
      recipient_email,
      status,
      provider_message_id,
      updated_at,
      notifications:notification_id (
        kind,
        student_id,
        students:student_id (full_name)
      )
    `)
    .eq('status', 'sent')
    .order('updated_at', { ascending: false });

  console.log(`\n=== SENT EMAILS BREAKDOWN ===`);
  
  const withName = sentEmails?.filter(e => e.notifications?.students?.full_name) || [];
  const withoutName = sentEmails?.filter(e => !e.notifications?.students?.full_name) || [];
  
  console.log(`Sent emails WITH student name: ${withName.length}`);
  console.log(`Sent emails WITHOUT student name (showed "Candidate"): ${withoutName.length}`);

  if (withoutName.length > 0) {
    console.log(`\n--- Emails sent as "Candidate" (no name) ---`);
    withoutName.slice(0, 10).forEach(e => {
      console.log(`  ${e.recipient_email} - ${new Date(e.updated_at).toLocaleString()}`);
    });
    if (withoutName.length > 10) {
      console.log(`  ... and ${withoutName.length - 10} more`);
    }
  }

  // Check queued emails
  const { data: queuedEmails } = await supabase
    .from('email_deliveries')
    .select(`
      id,
      recipient_email,
      notifications:notification_id (
        kind,
        student_id,
        students:student_id (full_name)
      )
    `)
    .eq('status', 'queued')
    .limit(5);

  console.log(`\n=== QUEUED EMAILS (next to be sent) ===`);
  console.log(`Sample of ${queued} queued emails:`);
  queuedEmails?.forEach(e => {
    const name = e.notifications?.students?.full_name || 'NO NAME';
    console.log(`  ${name.padEnd(25)} ${e.recipient_email}`);
  });
}

checkAll().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
