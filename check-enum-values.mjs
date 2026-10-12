const SUPABASE_URL = 'https://apzsuclpydjkmaffppmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwenN1Y2xweWRqa21hZmZwcG1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE2MTY3OCwiZXhwIjoyMTAzNzM3Njc4fQ.CQYy1IAXGnh-jyqnmwgAB8GQXJ4XE8npl5SUPtuWjeQ';

// Query arrear_policy values used in drives
console.log('=== CHECKING ARREAR_POLICY VALUES IN USE ===\n');

const response = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=arrears_policy`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (response.ok) {
  const drives = await response.json();
  const policyCounts = {};
  drives.forEach(d => {
    policyCounts[d.arrears_policy] = (policyCounts[d.arrears_policy] || 0) + 1;
  });
  console.log('Arrear policies in use:');
  Object.entries(policyCounts).forEach(([policy, count]) => {
    console.log(`  ${policy}: ${count} drives`);
  });
  
  // Check if any invalid values exist
  const validPolicies = ['no_standing', 'no_history', 'flexible'];
  const invalidPolicies = Object.keys(policyCounts).filter(p => !validPolicies.includes(p));
  
  if (invalidPolicies.length > 0) {
    console.log('\n⚠️  INVALID POLICIES FOUND:', invalidPolicies);
  } else {
    console.log('\n✓ All arrear_policy values are valid');
  }
}

// Check notification kinds more comprehensively
console.log('\n=== CHECKING ALL NOTIFICATION KINDS ===\n');
const notifResponse = await fetch(`${SUPABASE_URL}/rest/v1/notifications?select=kind&limit=10000`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (notifResponse.ok) {
  const notifications = await notifResponse.json();
  const kindCounts = {};
  notifications.forEach(n => {
    kindCounts[n.kind] = (kindCounts[n.kind] || 0) + 1;
  });
  
  console.log('Notification kinds in database:');
  Object.entries(kindCounts).forEach(([kind, count]) => {
    console.log(`  ${kind}: ${count} notifications`);
  });
  
  // Check which kinds are handled by email dispatch
  const handledKinds = ['welcome', 'drive_published', 'shortlisted', 'campus_drive_alert', 'cpc_drive_alert'];
  const unhandledKinds = Object.keys(kindCounts).filter(k => !handledKinds.includes(k));
  
  console.log('\n⚠️  Notification kinds NOT handled by current email dispatch:');
  unhandledKinds.forEach(k => {
    console.log(`  - ${k} (${kindCounts[k]} notifications)`);
  });
}

// Check email deliveries with provider_message_id
console.log('\n=== CHECKING EMAIL DELIVERY CONFIRMATIONS ===\n');
const emailResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=id,status,provider_message_id&limit=1000`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (emailResponse.ok) {
  const emails = await emailResponse.json();
  const withConfirmation = emails.filter(e => e.provider_message_id);
  const withoutConfirmation = emails.filter(e => !e.provider_message_id);
  
  console.log(`Total emails checked: ${emails.length}`);
  console.log(`With provider_message_id (confirmed): ${withConfirmation.length}`);
  console.log(`Without provider_message_id (unconfirmed): ${withoutConfirmation.length}`);
  
  if (withConfirmation.length === 0) {
    console.log('\n⚠️  NO emails have confirmation IDs from Resend');
    console.log('   This means pg_net is marking as sent without tracking actual delivery');
  }
}
