const firebase = require('firebase-tools');

(async () => {
    try {
        // Mock TTY to satisfy some internal checks if possible, 
        // though firebase-tools might check process.stdin directly.
        // We mainly resort to the API which might be more lenient.
        console.log("--- STARTING API LOGIN ---");
        const token = await firebase.login.ci({
            localhost: false
        });
        console.log("--- TOKEN CAPTURED ---");
        console.log(token);
    } catch (e) {
        console.log("--- ERROR ---");
        // Print the full error structure to see if it contains the URL
        console.dir(e, { depth: null });
        if (e.context && e.context.authUrl) {
            console.log("URL FOUND IN ERROR CONTEXT:");
            console.log(e.context.authUrl);
        }
    }
})();
