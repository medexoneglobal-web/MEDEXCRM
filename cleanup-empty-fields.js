const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

const REST_URL = `${SUPABASE_URL}/rest/v1/contacts`;
const PAGE_SIZE = 1000;
const UPDATE_BATCH_SIZE = 50;

function hasEmptyKey(data) {
    return Object.keys(data).some(k => k.includes('_EMPTY_') || k.startsWith('__'));
}

function cleanData(data) {
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
        if (key.includes('_EMPTY_') || key.startsWith('__')) {
            continue;
        }
        cleaned[key] = value;
    }
    return cleaned;
}

async function fetchContactsRange(start, end) {
    const res = await fetch(`${REST_URL}?select=id,data`, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Range': `${start}-${end}`
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch failed: HTTP ${res.status} ${text}`);
    }
    return res.json();
}

async function updateContact(id, data) {
    const res = await fetch(`${REST_URL}?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ data })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Update failed for id=${id}: HTTP ${res.status} ${text}`);
    }
}

async function main() {
    console.log('Starting cleanup of _EMPTY_ fields...');

    // Get total count
    const countRes = await fetch(`${REST_URL}?select=id`, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'count=exact',
            'Range': '0-0'
        }
    });
    const contentRange = countRes.headers.get('content-range');
    const totalMatch = contentRange && contentRange.match(/\/(\d+)$/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    console.log(`Total contacts: ${total}`);

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let updateQueue = [];

    for (let start = 0; start < total; start += PAGE_SIZE) {
        const end = Math.min(start + PAGE_SIZE - 1, total - 1);
        const rows = await fetchContactsRange(start, end);
        console.log(`Fetched rows ${start + 1}-${end + 1} (${rows.length} rows)`);

        for (const row of rows) {
            processed++;
            if (!row.data || !hasEmptyKey(row.data)) {
                skipped++;
                continue;
            }

            const cleaned = cleanData(row.data);
            updateQueue.push({ id: row.id, data: cleaned });

            if (updateQueue.length >= UPDATE_BATCH_SIZE) {
                await flushUpdates(updateQueue);
                updated += updateQueue.length;
                updateQueue = [];
            }
        }
    }

    if (updateQueue.length > 0) {
        await flushUpdates(updateQueue);
        updated += updateQueue.length;
    }

    console.log('\nCleanup complete!');
    console.log(`  Processed: ${processed}`);
    console.log(`  Updated:   ${updated}`);
    console.log(`  Skipped:   ${skipped}`);
}

async function flushUpdates(queue) {
    console.log(`  Flushing ${queue.length} updates...`);
    const results = await Promise.allSettled(
        queue.map(({ id, data }) => updateContact(id, data))
    );
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        console.error(`  ${failures.length} update(s) failed:`);
        failures.forEach(f => console.error(`    ${f.reason.message}`));
    } else {
        console.log(`  ${queue.length} update(s) succeeded.`);
    }
}

main().catch(err => {
    console.error(`\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
