const SUPABASE_URL = 'https://apzsuclpydjkmaffppmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwenN1Y2xweWRqa21hZmZwcG1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE2MTY3OCwiZXhwIjoyMTAzNzM3Njc4fQ.CQYy1IAXGnh-jyqnmwgAB8GQXJ4XE8npl5SUPtuWjeQ';

console.log('=== SCHEMA VERIFICATION ===\n');

// 1. Check arrear_policy enum values
console.log('1. Checking arrear_policy enum values...');
const enumResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_enum_values`, {
  method: 'POST',
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ enum_name: 'arrear_policy' })
});

if (enumResponse.ok) {
  const enumValues = await enumResponse.json();
  console.log('   Current values:', enumValues);
} else {
  console.log('   Could not query enum (function may not exist)');
}

// 2. Check notification kinds in use
console.log('\n2. Checking notification kinds in database...');
const kindsResponse = await fetch(`${SUPABASE_URL}/rest/v1/notifications?select=kind&limit=1000`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (kindsResponse.ok) {
  const notifications = await kindsResponse.json();
  const uniqueKinds = [...new Set(notifications.map(n => n.kind))];
  console.log('   Unique kinds found:', uniqueKinds.sort());
  console.log('   Total notifications:', notifications.length);
} else {
  console.log('   Error:', await kindsResponse.text());
}

// 3. Check email deliveries status
console.log('\n3. Checking email deliveries status...');
const emailResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=status&limit=10000`, {
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
  console.log('   Email status breakdown:', statusCounts);
} else {
  console.log('   Error:', await emailResponse.text());
}

// 4. Check if drives can be published (test the enum issue)
console.log('\n4. Checking recent drives...');
const drivesResponse = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=id,company_name,status,arrears_policy&order=created_at.desc&limit=5`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (drivesResponse.ok) {
  const drives = await drivesResponse.json();
  console.log('   Recent drives:');
  drives.forEach(d => {
    console.log(`     - ${d.company_name}: status=${d.status}, arrears_policy=${d.arrears_policy}`);
  });
} else {
  console.log('   Error:', await drivesResponse.text());
}

console.log('\n=== VERIFICATION COMPLETE ===');
