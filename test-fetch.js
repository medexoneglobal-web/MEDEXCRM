console.log('Script starting...');
const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

async function test() {
    try {
        console.log('Fetching...');
        const res = await fetch(`${SUPABASE_URL}/rest/v1/contacts?select=id,data&data->>ACCT%20NO=eq.M_6331`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        console.log('Response status:', res.status);
        const rows = await res.json();
        console.log('Found rows:', rows.length);
        console.log('First row:', rows[0]);
    } catch (err) {
        console.error('Error:', err);
    }
}

test();
