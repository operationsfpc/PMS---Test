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

async function estimate() {
  // Total students
  const { count: totalStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true });

  // Total drives
  const { count: totalDrives } = await supabase
    .from('drives')
    .select('*', { count: 'exact', head: true });

  // Drives in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentDrives } = await supabase
    .from('drives')
    .select('id, created_at')
    .gte('created_at', thirtyDaysAgo.toISOString());

  // Email deliveries breakdown
  const { count: totalEmails } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true });

  const { data: emails } = await supabase
    .from('email_deliveries')
    .select('id, created_at, status');

  // Emails in last 30 days
  const recentEmails = emails?.filter(e => new Date(e.created_at) >= thirtyDaysAgo) || [];

  // Notification types breakdown
  const { data: notifications } = await supabase
    .from('notifications')
    .select('kind, created_at');

  const recentNotifs = notifications?.filter(n => new Date(n.created_at) >= thirtyDaysAgo) || [];
  const notifByKind = {};
  recentNotifs.forEach(n => {
    notifByKind[n.kind] = (notifByKind[n.kind] || 0) + 1;
  });

  console.log('=== CURRENT SCALE ===');
  console.log(`Total students: ${totalStudents}`);
  console.log(`Total drives: ${totalDrives}`);
  console.log(`Drives created (last 30 days): ${recentDrives?.length || 0}`);
  console.log(`\n=== EMAIL VOLUME (last 30 days) ===`);
  console.log(`Total emails sent: ${recentEmails.length}`);
  console.log(`\nBy notification type:`);
  for (const [kind, count] of Object.entries(notifByKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  // Estimate monthly volume
  const avgEmailsPerDrive = recentDrives?.length > 0
    ? recentEmails.length / recentDrives.length
    : 0;

  console.log(`\n=== ESTIMATES ===`);
  console.log(`Avg emails per drive: ${Math.round(avgEmailsPerDrive)}`);
  console.log(`Avg drives per month: ${recentDrives?.length || 0}`);

  return {
    totalStudents,
    totalDrives,
    recentDrives: recentDrives?.length || 0,
    recentEmails: recentEmails.length,
    avgEmailsPerDrive: Math.round(avgEmailsPerDrive),
    notifByKind
  };
}

estimate().then(data => {
  console.log('\n=== RAW DATA ===');
  console.log(JSON.stringify(data, null, 2));
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
