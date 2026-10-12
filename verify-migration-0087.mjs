const SUPABASE_URL = 'https://apzsuclpydjkmaffppmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwenN1Y2xweWRqa21hZmZwcG1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE2MTY3OCwiZXhwIjoyMTAzNzM3Njc4fQ.CQYy1IAXGnh-jyqnmwgAB8GQXJ4XE8npl5SUPtuWjeQ';

console.log('=== VERIFYING MIGRATION 0087 ===\n');

// 1. Check email delivery status breakdown
console.log('1. Email delivery status:');
const emailResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=status`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (emailResponse.ok) {
  const emails = await emailResponse.json();
  const statusCounts = {};
  emails.forEach(e => {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  });
  console.log('   Status breakdown:', statusCounts);
  
  const queued = statusCounts['queued'] || 0;
  const sent = statusCounts['sent'] || 0;
  console.log(`   ✓ Queued: ${queued}, Sent: ${sent}`);
}

// 2. Check notification kinds and their email delivery status
console.log('\n2. Notification kinds with email delivery status:');
const notifResponse = await fetch(`${SUPABASE_URL}/rest/v1/notifications?select=kind,id`, {
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
  
  console.log('   Notification counts by kind:');
  Object.entries(kindCounts).forEach(([kind, count]) => {
    console.log(`     ${kind}: ${count}`);
  });
}

// 3. Check if emails are being processed (look at recent updates)
console.log('\n3. Recent email deliveries (last 10):');
const recentResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=id,status,updated_at,recipient_email&order=updated_at.desc&limit=10`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (recentResponse.ok) {
  const recent = await recentResponse.json();
  recent.forEach(e => {
    const time = new Date(e.updated_at).toLocaleTimeString();
    console.log(`   ${time} - ${e.status} - ${e.recipient_email}`);
  });
}

// 4. Check queued emails by notification kind
console.log('\n4. Queued emails by notification kind:');
const queuedResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=notification_id,status&status=eq.queued&limit=1000`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (queuedResponse.ok) {
  const queued = await queuedResponse.json();
  console.log(`   Total queued emails: ${queued.length}`);
  
  if (queued.length > 0) {
    // Get notification kinds for queued emails
    const notifIds = queued.map(q => q.notification_id).filter(Boolean);
    if (notifIds.length > 0) {
      const notifKindsResponse = await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=in.(${notifIds.slice(0, 100).join(',')})&select=id,kind`, {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`
        }
      });
      
      if (notifKindsResponse.ok) {
        const notifs = await notifKindsResponse.json();
        const kindMap = {};
        notifs.forEach(n => kindMap[n.id] = n.kind);
        
        const queuedByKind = {};
        queued.forEach(q => {
          if (q.notification_id && kindMap[q.notification_id]) {
            const kind = kindMap[q.notification_id];
            queuedByKind[kind] = (queuedByKind[kind] || 0) + 1;
          }
        });
        
        console.log('   Queued by kind:', queuedByKind);
      }
    }
  }
}

console.log('\n=== VERIFICATION COMPLETE ===');
