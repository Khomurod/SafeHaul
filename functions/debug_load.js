process.env.GCLOUD_PROJECT = 'truckerapp-system';
process.env.GCP_REGION = 'us-central1';
process.env.FUNCTION_REGION = 'us-central1';

try {
    console.log("Loading bulkActions...");
    const ba = require('./bulkActions');
    console.log("bulkActions loaded keys:", Object.keys(ba));

    console.log("Loading index...");
    const idx = require('./index');
    console.log("index loaded keys:", Object.keys(idx));
} catch (e) {
    console.error("LOAD ERROR:", e);
}
