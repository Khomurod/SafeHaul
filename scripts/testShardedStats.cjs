const assert = require('assert');

// Mock Data: Shards
const shards = [
    { stats: { total: 10, missingContact: 2 } },
    { stats: { total: 5, missingContact: 1 } },
    { stats: { total: 20, missingContact: 5 } }
];

console.log("Testing Stats Aggregation...");

let aggregated = { total: 0, missingContact: 0 };

shards.forEach(shard => {
    const stats = shard.stats;
    for (const [key, val] of Object.entries(stats)) {
        aggregated[key] = (aggregated[key] || 0) + val;
    }
});

console.log("Aggregated Result:", aggregated);

try {
    assert.strictEqual(aggregated.total, 35, "Total should be 35");
    assert.strictEqual(aggregated.missingContact, 8, "Missing Contact should be 8");
    console.log("PASSED: Aggregation logic is correct.");
} catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
}
