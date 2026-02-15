const assert = require('assert');

function checkAuth(headers, method) {
    const hasQueueHeader = headers["x-appengine-queuename"] || headers["x-cloudtasks-queuename"];

    if (method !== 'POST') return { status: 405 };
    if (!hasQueueHeader) return { status: 403 };
    return { status: 200 };
}

console.log("Testing Worker Security...");

const tests = [
    { name: "Valid Request", headers: { "x-cloudtasks-queuename": "queue" }, method: "POST", expected: 200 },
    { name: "Missing Header", headers: {}, method: "POST", expected: 403 },
    { name: "Wrong Method", headers: { "x-cloudtasks-queuename": "queue" }, method: "GET", expected: 405 },
    { name: "AppEngine Header", headers: { "x-appengine-queuename": "queue" }, method: "POST", expected: 200 }
];

let failures = 0;
tests.forEach(t => {
    const res = checkAuth(t.headers, t.method);
    if (res.status !== t.expected) {
        console.error(`FAILED: ${t.name} (Exp: ${t.expected}, Got: ${res.status})`);
        failures++;
    } else {
        console.log(`PASSED: ${t.name}`);
    }
});

if (failures > 0) process.exit(1);
console.log("All Security Tests Passed.");
