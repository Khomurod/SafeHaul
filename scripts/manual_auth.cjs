const firebase = require('firebase-tools');

(async () => {
    try {
        console.log("--- STARTING API LOGIN ---");
        // We set interactive: true to force it to TRY to output the prompt/URL
        // usually 'interactive: false' is what causes the 'cannot run in non-interactive' error.
        // But if stdin is not a TTY, it might fail anyway.
        // However, we want the URL.
        const token = await firebase.login.ci({
            localhost: false,
            interactive: true // EXPERIMENTAL: trying to force it to proceed
        });
        console.log("--- TOKEN CAPTURED ---");
        console.log(token);
    } catch (e) {
        console.log("--- ERROR ---");
        // console.dir(e, { depth: null });
        if (e.message) console.log("Message:", e.message);

        // Sometimes the URL is in the error message or context
        if (e.context && e.context.authUrl) {
            console.log("URL FOUND IN ERROR CONTEXT:");
            console.log(e.context.authUrl);
        }
    }
})();
