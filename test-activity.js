const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

async function cleanupDuplicates() {
    console.log('Searching for duplicate M_6331 entries...');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/contacts?select=id,data&data->>ACCT%20NO=eq.M_6331`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const rows = await res.json();
    console.log('Found', rows.length, 'M_6331 entries');

    if (!Array.isArray(rows) || rows.length <= 1) {
        console.log('No duplicates to clean up.');
        return;
    }

    for (let i = 1; i < rows.length; i++) {
        const delRes = await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${rows[i].id}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (delRes.ok) {
            console.log('Deleted duplicate id:', rows[i].id);
        } else {
            console.error('Failed to delete id:', rows[i].id, await delRes.text());
        }
    }
    console.log('Cleanup complete.');
}

cleanupDuplicates().catch(err => {
    console.error('Cleanup error:', err);
    process.exit(1);
});
