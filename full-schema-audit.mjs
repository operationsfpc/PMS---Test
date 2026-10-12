const SUPABASE_URL = 'https://apzsuclpydjkmaffppmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwenN1Y2xweWRqa21hZmZwcG1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE2MTY3OCwiZXhwIjoyMTAzNzM3Njc4fQ.CQYy1IAXGnh-jyqnmwgAB8GQXJ4XE8npl5SUPtuWjeQ';

console.log('=== FULL SCHEMA AUDIT: LIVE DB vs CODE ===\n');

// Get all tables
const tablesResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (tablesResponse.ok) {
  const tables = await tablesResponse.json();
  const tableNames = Object.keys(tables).filter(k => !k.startsWith('pg_') && k !== 'information_schema');
  console.log(`Tables in live database: ${tableNames.length}`);
  console.log(tableNames.sort().join(', '));
}

// Check drives table schema
console.log('\n--- DRIVES TABLE ---');
const drivesResponse = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=*&limit=1`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (drivesResponse.ok) {
  const drives = await drivesResponse.json();
  if (drives.length > 0) {
    const columns = Object.keys(drives[0]);
    console.log(`Columns: ${columns.length}`);
    console.log('Sample columns:', columns.slice(0, 20).join(', '));
  }
}

// Check students table schema
console.log('\n--- STUDENTS TABLE ---');
const studentsResponse = await fetch(`${SUPABASE_URL}/rest/v1/students?select=*&limit=1`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (studentsResponse.ok) {
  const students = await studentsResponse.json();
  if (students.length > 0) {
    const columns = Object.keys(students[0]);
    console.log(`Columns: ${columns.length}`);
    console.log('Sample columns:', columns.slice(0, 20).join(', '));
  }
}

// Check notifications table
console.log('\n--- NOTIFICATIONS TABLE ---');
const notifsResponse = await fetch(`${SUPABASE_URL}/rest/v1/notifications?select=*&limit=1`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (notifsResponse.ok) {
  const notifs = await notifsResponse.json();
  if (notifs.length > 0) {
    const columns = Object.keys(notifs[0]);
    console.log(`Columns: ${columns.join(', ')}`);
  }
}

// Check email_deliveries table
console.log('\n--- EMAIL_DELIVERIES TABLE ---');
const emailsResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_deliveries?select=*&limit=1`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (emailsResponse.ok) {
  const emails = await emailsResponse.json();
  if (emails.length > 0) {
    const columns = Object.keys(emails[0]);
    console.log(`Columns: ${columns.join(', ')}`);
  }
}

// Check for any drives with invalid enum values
console.log('\n--- CHECKING FOR INVALID ENUM VALUES ---');
const allDrivesResponse = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=arrears_policy,drive_mode,drive_type,offer_category,status,role_category`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (allDrivesResponse.ok) {
  const allDrives = await allDrivesResponse.json();
  
  const validArrears = ['no_standing', 'no_history', 'flexible'];
  const validModes = ['on_campus', 'physical_outside_campus', 'virtual', 'pooled'];
  const validTypes = ['placement', 'internship_convertible', 'internship'];
  const validCategories = ['internship', 'regular', 'dream', 'super_dream'];
  const validStatuses = ['draft', 'submitted', 'approved', 'live', 'applications_closed', 'in_rounds', 'completed', 'rejected'];
  const validRoles = ['software_technical', 'technical_support_it_ops', 'digital_marketing', 'sales', 'operations_business'];
  
  const invalidArrears = allDrives.filter(d => d.arrears_policy && !validArrears.includes(d.arrears_policy));
  const invalidModes = allDrives.filter(d => d.drive_mode && !validModes.includes(d.drive_mode));
  const invalidTypes = allDrives.filter(d => d.drive_type && !validTypes.includes(d.drive_type));
  const invalidCategories = allDrives.filter(d => d.offer_category && !validCategories.includes(d.offer_category));
  const invalidStatuses = allDrives.filter(d => d.status && !validStatuses.includes(d.status));
  const invalidRoles = allDrives.filter(d => d.role_category && !validRoles.includes(d.role_category));
  
  console.log(`Drives checked: ${allDrives.length}`);
  console.log(`Invalid arrears_policy: ${invalidArrears.length}`);
  console.log(`Invalid drive_mode: ${invalidModes.length}`);
  console.log(`Invalid drive_type: ${invalidTypes.length}`);
  console.log(`Invalid offer_category: ${invalidCategories.length}`);
  console.log(`Invalid status: ${invalidStatuses.length}`);
  console.log(`Invalid role_category: ${invalidRoles.length}`);
  
  if (invalidArrears.length > 0) console.log('  Invalid arrears:', [...new Set(invalidArrears.map(d => d.arrears_policy))]);
  if (invalidModes.length > 0) console.log('  Invalid modes:', [...new Set(invalidModes.map(d => d.drive_mode))]);
  if (invalidTypes.length > 0) console.log('  Invalid types:', [...new Set(invalidTypes.map(d => d.drive_type))]);
  if (invalidCategories.length > 0) console.log('  Invalid categories:', [...new Set(invalidCategories.map(d => d.offer_category))]);
  if (invalidStatuses.length > 0) console.log('  Invalid statuses:', [...new Set(invalidStatuses.map(d => d.status))]);
  if (invalidRoles.length > 0) console.log('  Invalid roles:', [...new Set(invalidRoles.map(d => d.role_category))]);
}

console.log('\n=== AUDIT COMPLETE ===');
